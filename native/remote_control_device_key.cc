#include <node_api.h>

#include <libsecret/secret.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/x509.h>

#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <array>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr std::string_view kAlgorithm = "ecdsa_p256_sha256";
constexpr std::string_view kProtectionClass = "os_protected_nonextractable";
constexpr std::string_view kAllowedPolicy = "allow_os_protected_nonextractable";
constexpr std::string_view kHardwarePolicy = "hardware_only";
constexpr std::string_view kKeyIdPrefix = "dk_osn_linux_v1_";
constexpr std::string_view kProvider = "linux-secret-service-v1";
constexpr std::string_view kRecordDirectory = "device-keys-os-protected-v1";
constexpr size_t kRandomKeyIdBytes = 16;
constexpr size_t kMaximumPayloadBytes = 1024 * 1024;
constexpr size_t kMaximumRecordBytes = 8192;

const SecretSchema kSecretSchema = {
    "com.openai.codex.remote-control-device-key",
    SECRET_SCHEMA_NONE,
    {
        {"key_id", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {"provider", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING},
    },
    0,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
};

struct EvpPkeyDeleter {
  void operator()(EVP_PKEY* key) const { EVP_PKEY_free(key); }
};

struct EvpPkeyContextDeleter {
  void operator()(EVP_PKEY_CTX* context) const { EVP_PKEY_CTX_free(context); }
};

struct EvpMessageDigestContextDeleter {
  void operator()(EVP_MD_CTX* context) const { EVP_MD_CTX_free(context); }
};

using UniquePkey = std::unique_ptr<EVP_PKEY, EvpPkeyDeleter>;
using UniquePkeyContext = std::unique_ptr<EVP_PKEY_CTX, EvpPkeyContextDeleter>;
using UniqueMessageDigestContext =
    std::unique_ptr<EVP_MD_CTX, EvpMessageDigestContextDeleter>;

class FileDescriptor {
 public:
  explicit FileDescriptor(int value = -1) : value_(value) {}
  FileDescriptor(const FileDescriptor&) = delete;
  FileDescriptor& operator=(const FileDescriptor&) = delete;
  FileDescriptor(FileDescriptor&& other) noexcept : value_(other.value_) {
    other.value_ = -1;
  }
  FileDescriptor& operator=(FileDescriptor&& other) noexcept {
    if (this != &other) {
      Reset();
      value_ = other.value_;
      other.value_ = -1;
    }
    return *this;
  }
  ~FileDescriptor() { Reset(); }

  int Get() const { return value_; }
  explicit operator bool() const { return value_ >= 0; }

 private:
  void Reset() {
    if (value_ >= 0) close(value_);
    value_ = -1;
  }

  int value_;
};

class SecretPassword {
 public:
  explicit SecretPassword(char* value) : value_(value) {}
  SecretPassword(const SecretPassword&) = delete;
  SecretPassword& operator=(const SecretPassword&) = delete;
  ~SecretPassword() {
    if (value_ != nullptr) secret_password_wipe(value_);
  }

  const char* Get() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }

 private:
  char* value_;
};

class SensitiveString {
 public:
  explicit SensitiveString(std::string value) : value_(std::move(value)) {}
  SensitiveString(const SensitiveString&) = delete;
  SensitiveString& operator=(const SensitiveString&) = delete;
  ~SensitiveString() {
    if (!value_.empty()) OPENSSL_cleanse(value_.data(), value_.size());
  }

  const std::string& Get() const { return value_; }

 private:
  std::string value_;
};

class SensitiveBytes {
 public:
  explicit SensitiveBytes(std::vector<unsigned char> value) : value_(std::move(value)) {}
  SensitiveBytes(const SensitiveBytes&) = delete;
  SensitiveBytes& operator=(const SensitiveBytes&) = delete;
  ~SensitiveBytes() {
    if (!value_.empty()) OPENSSL_cleanse(value_.data(), value_.size());
  }

  const std::vector<unsigned char>& Get() const { return value_; }

 private:
  std::vector<unsigned char> value_;
};

struct KeyRecord {
  std::string key_id;
  std::string public_key_spki_der_base64;
};

enum class Operation { kCreate, kDelete, kGetPublic, kSign };

struct Work {
  napi_env env = nullptr;
  napi_async_work async_work = nullptr;
  napi_deferred deferred = nullptr;
  Operation operation = Operation::kCreate;
  std::string policy;
  std::string key_id;
  std::vector<unsigned char> payload;
  KeyRecord record;
  std::string signature_der_base64;
  std::string error;
};

[[noreturn]] void ThrowSystemError(std::string_view message) {
  throw std::runtime_error(std::string(message) + ": " + std::strerror(errno));
}

void CheckNapi(napi_env env, napi_status status, const char* operation) {
  if (status == napi_ok) return;
  const napi_extended_error_info* information = nullptr;
  napi_get_last_error_info(env, &information);
  std::string message(operation);
  if (information != nullptr && information->error_message != nullptr) {
    message += ": ";
    message += information->error_message;
  }
  throw std::runtime_error(message);
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  CheckNapi(env, napi_get_value_string_utf8(env, value, nullptr, 0, &length),
            "read string length");
  std::string result(length, '\0');
  CheckNapi(env,
            napi_get_value_string_utf8(env, value, result.data(), result.size() + 1, &length),
            "read string");
  result.resize(length);
  return result;
}

bool IsString(napi_env env, napi_value value) {
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, value, &type), "inspect value type");
  return type == napi_string;
}

void ThrowTypeError(napi_env env, const char* message) {
  CheckNapi(env, napi_throw_type_error(env, nullptr, message), "throw type error");
}

napi_value MakeString(napi_env env, std::string_view value) {
  napi_value result = nullptr;
  CheckNapi(env,
            napi_create_string_utf8(env, value.data(), value.size(), &result),
            "create string");
  return result;
}

void SetStringProperty(napi_env env, napi_value object, const char* name,
                       std::string_view value) {
  CheckNapi(env, napi_set_named_property(env, object, name, MakeString(env, value)),
            "set object property");
}

bool IsLowerHex(char character) {
  return (character >= '0' && character <= '9') ||
         (character >= 'a' && character <= 'f');
}

bool IsValidKeyId(std::string_view key_id) {
  if (!key_id.starts_with(kKeyIdPrefix) ||
      key_id.size() != kKeyIdPrefix.size() + kRandomKeyIdBytes * 2) {
    return false;
  }
  for (size_t index = kKeyIdPrefix.size(); index < key_id.size(); ++index) {
    if (!IsLowerHex(key_id[index])) return false;
  }
  return true;
}

std::string GenerateKeyId() {
  std::array<unsigned char, kRandomKeyIdBytes> random{};
  if (RAND_bytes(random.data(), random.size()) != 1) {
    throw std::runtime_error("cannot generate device key id");
  }
  constexpr char hexadecimal[] = "0123456789abcdef";
  std::string result(kKeyIdPrefix);
  result.reserve(kKeyIdPrefix.size() + random.size() * 2);
  for (unsigned char byte : random) {
    result.push_back(hexadecimal[byte >> 4]);
    result.push_back(hexadecimal[byte & 0x0f]);
  }
  return result;
}

std::string Base64Encode(const std::vector<unsigned char>& bytes) {
  if (bytes.empty()) return {};
  std::string output(4 * ((bytes.size() + 2) / 3), '\0');
  const int encoded = EVP_EncodeBlock(
      reinterpret_cast<unsigned char*>(output.data()), bytes.data(), bytes.size());
  if (encoded < 0) throw std::runtime_error("cannot encode device key data");
  output.resize(static_cast<size_t>(encoded));
  return output;
}

std::vector<unsigned char> Base64Decode(std::string_view encoded) {
  if (encoded.empty() || encoded.size() % 4 != 0) {
    throw std::runtime_error("invalid encoded device key data");
  }
  std::vector<unsigned char> output((encoded.size() / 4) * 3);
  const int decoded = EVP_DecodeBlock(output.data(),
                                      reinterpret_cast<const unsigned char*>(encoded.data()),
                                      encoded.size());
  if (decoded < 0) throw std::runtime_error("invalid encoded device key data");
  size_t padding = 0;
  if (!encoded.empty() && encoded.back() == '=') ++padding;
  if (encoded.size() > 1 && encoded[encoded.size() - 2] == '=') ++padding;
  output.resize(static_cast<size_t>(decoded) - padding);
  return output;
}

std::vector<unsigned char> EncodePublicKey(EVP_PKEY* key) {
  const int length = i2d_PUBKEY(key, nullptr);
  if (length <= 0) throw std::runtime_error("cannot encode device public key");
  std::vector<unsigned char> output(static_cast<size_t>(length));
  unsigned char* cursor = output.data();
  if (i2d_PUBKEY(key, &cursor) != length) {
    throw std::runtime_error("cannot encode device public key");
  }
  return output;
}

std::vector<unsigned char> EncodePrivateKey(EVP_PKEY* key) {
  const int length = i2d_PrivateKey(key, nullptr);
  if (length <= 0) throw std::runtime_error("cannot encode private device key");
  std::vector<unsigned char> output(static_cast<size_t>(length));
  unsigned char* cursor = output.data();
  if (i2d_PrivateKey(key, &cursor) != length) {
    throw std::runtime_error("cannot encode private device key");
  }
  return output;
}

UniquePkey DecodePrivateKey(const std::vector<unsigned char>& encoded) {
  const unsigned char* cursor = encoded.data();
  EVP_PKEY* raw = d2i_AutoPrivateKey(nullptr, &cursor, encoded.size());
  if (raw == nullptr || cursor != encoded.data() + encoded.size()) {
    EVP_PKEY_free(raw);
    throw std::runtime_error("stored device key is invalid");
  }
  return UniquePkey(raw);
}

UniquePkey DecodePublicKey(const std::vector<unsigned char>& encoded) {
  const unsigned char* cursor = encoded.data();
  EVP_PKEY* raw = d2i_PUBKEY(nullptr, &cursor, encoded.size());
  if (raw == nullptr || cursor != encoded.data() + encoded.size()) {
    EVP_PKEY_free(raw);
    throw std::runtime_error("stored device public key is invalid");
  }
  return UniquePkey(raw);
}

UniquePkey GenerateP256Key() {
  UniquePkeyContext context(EVP_PKEY_CTX_new_from_name(nullptr, "EC", nullptr));
  if (!context || EVP_PKEY_keygen_init(context.get()) <= 0) {
    throw std::runtime_error("cannot initialize device key generation");
  }
  char group_name[] = "prime256v1";
  OSSL_PARAM parameters[] = {
      OSSL_PARAM_construct_utf8_string("group", group_name, 0),
      OSSL_PARAM_construct_end(),
  };
  if (EVP_PKEY_CTX_set_params(context.get(), parameters) <= 0) {
    throw std::runtime_error("cannot configure P-256 device key generation");
  }
  EVP_PKEY* raw = nullptr;
  if (EVP_PKEY_generate(context.get(), &raw) <= 0 || raw == nullptr) {
    EVP_PKEY_free(raw);
    throw std::runtime_error("cannot generate P-256 device key");
  }
  return UniquePkey(raw);
}

std::vector<unsigned char> Sign(EVP_PKEY* key,
                                const std::vector<unsigned char>& payload) {
  UniqueMessageDigestContext context(EVP_MD_CTX_new());
  if (!context || EVP_DigestSignInit(context.get(), nullptr, EVP_sha256(), nullptr, key) <= 0) {
    throw std::runtime_error("cannot initialize device key signing");
  }
  size_t length = 0;
  if (EVP_DigestSign(context.get(), nullptr, &length, payload.data(), payload.size()) <= 0 ||
      length == 0) {
    throw std::runtime_error("cannot size device key signature");
  }
  std::vector<unsigned char> signature(length);
  if (EVP_DigestSign(context.get(), signature.data(), &length, payload.data(), payload.size()) <=
      0) {
    throw std::runtime_error("cannot generate device key signature");
  }
  signature.resize(length);
  return signature;
}

void Verify(EVP_PKEY* key, const std::vector<unsigned char>& payload,
            const std::vector<unsigned char>& signature) {
  UniqueMessageDigestContext context(EVP_MD_CTX_new());
  if (!context || EVP_DigestVerifyInit(context.get(), nullptr, EVP_sha256(), nullptr, key) <=
                      0) {
    throw std::runtime_error("cannot initialize device key verification");
  }
  if (EVP_DigestVerify(context.get(), signature.data(), signature.size(), payload.data(),
                       payload.size()) != 1) {
    throw std::runtime_error("device key signature verification failed");
  }
}

std::filesystem::path ResolveCodexHome() {
  const char* codex_home = std::getenv("CODEX_HOME");
  if (codex_home != nullptr && codex_home[0] != '\0') return codex_home;
  const char* home = std::getenv("HOME");
  if (home == nullptr || home[0] == '\0') {
    throw std::runtime_error("cannot determine secure device-key store location");
  }
  return std::filesystem::path(home) / ".codex";
}

void ValidatePrivateDirectory(const std::filesystem::path& path) {
  struct stat information {};
  if (lstat(path.c_str(), &information) != 0) ThrowSystemError("cannot inspect device key directory");
  if (!S_ISDIR(information.st_mode) || S_ISLNK(information.st_mode) ||
      information.st_uid != geteuid() || (information.st_mode & 0077) != 0) {
    throw std::runtime_error("unsafe or inaccessible device key directory");
  }
}

void EnsurePrivateDirectory(const std::filesystem::path& path) {
  std::error_code error;
  if (!std::filesystem::exists(path, error)) {
    if (!std::filesystem::create_directories(path, error) || error) {
      throw std::runtime_error("cannot create device key directory");
    }
    if (chmod(path.c_str(), 0700) != 0) ThrowSystemError("cannot secure device key directory");
  } else if (error) {
    throw std::runtime_error("cannot inspect device key directory");
  }
  ValidatePrivateDirectory(path);
}

FileDescriptor OpenStoreDirectory() {
  const std::filesystem::path codex_home = ResolveCodexHome();
  EnsurePrivateDirectory(codex_home);
  const std::filesystem::path store = codex_home / kRecordDirectory;
  EnsurePrivateDirectory(store);
  const int descriptor = open(store.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) ThrowSystemError("cannot open device key directory");
  return FileDescriptor(descriptor);
}

FileDescriptor LockStore(int store_descriptor, int operation) {
  const int descriptor =
      openat(store_descriptor, ".lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (descriptor < 0) ThrowSystemError("cannot open device key store lock");
  struct stat information {};
  if (fstat(descriptor, &information) != 0) ThrowSystemError("cannot inspect device key lock");
  if (!S_ISREG(information.st_mode) || information.st_uid != geteuid() ||
      (information.st_mode & 0077) != 0) {
    throw std::runtime_error("unsafe device key store lock");
  }
  if (flock(descriptor, operation) != 0) ThrowSystemError("cannot lock device key store");
  return FileDescriptor(descriptor);
}

std::string RecordName(std::string_view key_id) { return std::string(key_id) + ".record"; }

void WriteAll(int descriptor, std::string_view value) {
  size_t written = 0;
  while (written < value.size()) {
    const ssize_t count = write(descriptor, value.data() + written, value.size() - written);
    if (count < 0) {
      if (errno == EINTR) continue;
      ThrowSystemError("cannot write device key record");
    }
    written += static_cast<size_t>(count);
  }
}

std::string SerializeRecord(const KeyRecord& record) {
  return "schema_version=1\nkey_id=" + record.key_id + "\nalgorithm=" +
         std::string(kAlgorithm) + "\nprotection_class=" + std::string(kProtectionClass) +
         "\npublic_key_spki_der_base64=" + record.public_key_spki_der_base64 + "\n";
}

void WriteRecord(int store_descriptor, const KeyRecord& record) {
  const std::string final_name = RecordName(record.key_id);
  const std::string temporary_name = ".tmp-" + GenerateKeyId();
  bool published = false;
  const int raw = openat(store_descriptor, temporary_name.c_str(),
                         O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (raw < 0) ThrowSystemError("cannot create device key record");
  FileDescriptor temporary(raw);
  try {
    const std::string encoded = SerializeRecord(record);
    WriteAll(temporary.Get(), encoded);
    if (fsync(temporary.Get()) != 0) ThrowSystemError("cannot persist device key record");
    if (linkat(store_descriptor, temporary_name.c_str(), store_descriptor, final_name.c_str(),
               0) != 0) {
      ThrowSystemError("cannot publish device key record");
    }
    published = true;
    if (unlinkat(store_descriptor, temporary_name.c_str(), 0) != 0) {
      ThrowSystemError("cannot remove temporary device key record");
    }
    if (fsync(store_descriptor) != 0) ThrowSystemError("cannot persist device key directory");
  } catch (...) {
    unlinkat(store_descriptor, temporary_name.c_str(), 0);
    if (published) unlinkat(store_descriptor, final_name.c_str(), 0);
    throw;
  }
}

std::string ReadAll(int descriptor, size_t expected_size) {
  std::string result(expected_size, '\0');
  size_t read_bytes = 0;
  while (read_bytes < result.size()) {
    const ssize_t count = read(descriptor, result.data() + read_bytes, result.size() - read_bytes);
    if (count < 0) {
      if (errno == EINTR) continue;
      ThrowSystemError("cannot read device key record");
    }
    if (count == 0) throw std::runtime_error("cannot read complete device key record");
    read_bytes += static_cast<size_t>(count);
  }
  return result;
}

std::string FindRecordValue(std::string_view record, std::string_view name) {
  const std::string prefix = std::string(name) + "=";
  size_t start = 0;
  while (start < record.size()) {
    const size_t end = record.find('\n', start);
    const std::string_view line = record.substr(
        start, end == std::string_view::npos ? record.size() - start : end - start);
    if (line.starts_with(prefix)) return std::string(line.substr(prefix.size()));
    if (end == std::string_view::npos) break;
    start = end + 1;
  }
  throw std::runtime_error("invalid device key record");
}

KeyRecord ParseRecord(std::string_view encoded, std::string_view expected_key_id) {
  if (FindRecordValue(encoded, "schema_version") != "1" ||
      FindRecordValue(encoded, "algorithm") != kAlgorithm ||
      FindRecordValue(encoded, "protection_class") != kProtectionClass) {
    throw std::runtime_error("unsupported device key record");
  }
  KeyRecord result{
      .key_id = FindRecordValue(encoded, "key_id"),
      .public_key_spki_der_base64 = FindRecordValue(encoded, "public_key_spki_der_base64"),
  };
  if (result.key_id != expected_key_id || !IsValidKeyId(result.key_id) ||
      result.public_key_spki_der_base64.empty()) {
    throw std::runtime_error("invalid device key record");
  }
  const std::vector<unsigned char> public_der = Base64Decode(result.public_key_spki_der_base64);
  DecodePublicKey(public_der);
  return result;
}

KeyRecord ReadRecord(int store_descriptor, std::string_view key_id) {
  const std::string name = RecordName(key_id);
  const int raw = openat(store_descriptor, name.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (raw < 0) {
    if (errno == ENOENT) throw std::runtime_error("device key not found");
    ThrowSystemError("cannot open device key record");
  }
  FileDescriptor descriptor(raw);
  struct stat information {};
  if (fstat(descriptor.Get(), &information) != 0) {
    ThrowSystemError("cannot inspect device key record");
  }
  if (!S_ISREG(information.st_mode) || information.st_uid != geteuid() ||
      (information.st_mode & 0077) != 0 || information.st_size <= 0 ||
      static_cast<size_t>(information.st_size) > kMaximumRecordBytes) {
    throw std::runtime_error("unsafe or invalid device key record");
  }
  return ParseRecord(ReadAll(descriptor.Get(), information.st_size), key_id);
}

std::string SecretStoreError(const char* operation, GError* error) {
  std::string message(operation);
  if (error != nullptr && error->message != nullptr) {
    message += ": ";
    message += error->message;
  }
  if (error != nullptr) g_error_free(error);
  return message;
}

void StorePrivateKey(const std::string& key_id, const std::string& private_key_base64) {
  GError* error = nullptr;
  const std::string label = "Codex remote-control device key " + key_id;
  const gboolean stored = secret_password_store_sync(
      &kSecretSchema, SECRET_COLLECTION_DEFAULT, label.c_str(),
      private_key_base64.c_str(), nullptr, &error, "key_id", key_id.c_str(), "provider",
      kProvider.data(), nullptr);
  if (!stored) throw std::runtime_error(SecretStoreError("cannot store private device key", error));
  if (error != nullptr) g_error_free(error);
}

SecretPassword LoadPrivateKey(std::string_view key_id) {
  GError* error = nullptr;
  char* value = secret_password_lookup_nonpageable_sync(
      &kSecretSchema, nullptr, &error, "key_id", std::string(key_id).c_str(), "provider",
      kProvider.data(), nullptr);
  if (error != nullptr) {
    throw std::runtime_error(SecretStoreError("cannot load private device key", error));
  }
  if (value == nullptr) throw std::runtime_error("device key secret not found");
  return SecretPassword(value);
}

void ClearPrivateKey(std::string_view key_id) {
  GError* error = nullptr;
  secret_password_clear_sync(
      &kSecretSchema, nullptr, &error, "key_id", std::string(key_id).c_str(), "provider",
      kProvider.data(), nullptr);
  if (error != nullptr) {
    throw std::runtime_error(SecretStoreError("cannot delete private device key", error));
  }
}

KeyRecord CreateDeviceKey() {
  UniquePkey key = GenerateP256Key();
  const std::vector<unsigned char> public_der = EncodePublicKey(key.get());
  SensitiveBytes private_der(EncodePrivateKey(key.get()));
  SensitiveString private_base64(Base64Encode(private_der.Get()));
  KeyRecord record{
      .key_id = GenerateKeyId(),
      .public_key_spki_der_base64 = Base64Encode(public_der),
  };

  std::vector<unsigned char> self_test(32);
  if (RAND_bytes(self_test.data(), self_test.size()) != 1) {
    throw std::runtime_error("cannot generate device key self-test payload");
  }
  const std::vector<unsigned char> signature = Sign(key.get(), self_test);
  Verify(key.get(), self_test, signature);

  FileDescriptor store = OpenStoreDirectory();
  FileDescriptor lock = LockStore(store.Get(), LOCK_EX);
  StorePrivateKey(record.key_id, private_base64.Get());
  try {
    WriteRecord(store.Get(), record);
  } catch (...) {
    try {
      ClearPrivateKey(record.key_id);
    } catch (...) {
    }
    throw;
  }
  return record;
}

void DeleteDeviceKey(std::string_view key_id) {
  FileDescriptor store = OpenStoreDirectory();
  FileDescriptor lock = LockStore(store.Get(), LOCK_EX);
  ClearPrivateKey(key_id);
  const std::string name = RecordName(key_id);
  if (unlinkat(store.Get(), name.c_str(), 0) != 0 && errno != ENOENT) {
    ThrowSystemError("cannot delete device key record");
  }
  if (fsync(store.Get()) != 0) ThrowSystemError("cannot persist device key deletion");
}

KeyRecord GetDeviceKeyPublic(std::string_view key_id) {
  FileDescriptor store = OpenStoreDirectory();
  FileDescriptor lock = LockStore(store.Get(), LOCK_SH);
  return ReadRecord(store.Get(), key_id);
}

std::string SignDeviceKey(std::string_view key_id,
                          const std::vector<unsigned char>& payload) {
  FileDescriptor store = OpenStoreDirectory();
  FileDescriptor lock = LockStore(store.Get(), LOCK_SH);
  const KeyRecord record = ReadRecord(store.Get(), key_id);
  SecretPassword encoded_private = LoadPrivateKey(key_id);
  SensitiveBytes private_der(Base64Decode(encoded_private.Get()));
  UniquePkey private_key = DecodePrivateKey(private_der.Get());
  const std::string derived_public = Base64Encode(EncodePublicKey(private_key.get()));
  if (derived_public != record.public_key_spki_der_base64) {
    throw std::runtime_error("device key public record does not match its secret");
  }
  const std::vector<unsigned char> signature = Sign(private_key.get(), payload);
  const std::vector<unsigned char> public_der = Base64Decode(record.public_key_spki_der_base64);
  UniquePkey public_key = DecodePublicKey(public_der);
  Verify(public_key.get(), payload, signature);
  return Base64Encode(signature);
}

void ExecuteWork(napi_env, void* data) {
  Work* work = static_cast<Work*>(data);
  try {
    switch (work->operation) {
      case Operation::kCreate:
        if (work->policy == kHardwarePolicy) {
          throw std::runtime_error("hardware-only device keys require a usable TPM 2.0");
        }
        work->record = CreateDeviceKey();
        break;
      case Operation::kDelete:
        DeleteDeviceKey(work->key_id);
        break;
      case Operation::kGetPublic:
        work->record = GetDeviceKeyPublic(work->key_id);
        break;
      case Operation::kSign:
        work->signature_der_base64 = SignDeviceKey(work->key_id, work->payload);
        break;
    }
  } catch (const std::exception& error) {
    work->error = error.what();
  } catch (...) {
    work->error = "unknown device key provider failure";
  }
}

napi_value MakePublicResult(napi_env env, const KeyRecord& record, bool include_key_id) {
  napi_value result = nullptr;
  CheckNapi(env, napi_create_object(env, &result), "create device key result");
  if (include_key_id) SetStringProperty(env, result, "keyId", record.key_id);
  SetStringProperty(env, result, "algorithm", kAlgorithm);
  SetStringProperty(env, result, "protectionClass", kProtectionClass);
  SetStringProperty(env, result, "publicKeySpkiDerBase64", record.public_key_spki_der_base64);
  return result;
}

void CompleteWork(napi_env env, napi_status status, void* data) {
  std::unique_ptr<Work> work(static_cast<Work*>(data));
  try {
    if (status != napi_ok && work->error.empty()) work->error = "device key operation cancelled";
    if (!work->error.empty()) {
      napi_value message = MakeString(env, work->error);
      napi_value error = nullptr;
      CheckNapi(env, napi_create_error(env, nullptr, message, &error), "create device key error");
      CheckNapi(env, napi_reject_deferred(env, work->deferred, error), "reject device key promise");
    } else {
      napi_value result = nullptr;
      switch (work->operation) {
        case Operation::kCreate:
          result = MakePublicResult(env, work->record, true);
          break;
        case Operation::kGetPublic:
          result = MakePublicResult(env, work->record, true);
          break;
        case Operation::kSign:
          CheckNapi(env, napi_create_object(env, &result), "create signature result");
          SetStringProperty(env, result, "algorithm", kAlgorithm);
          SetStringProperty(env, result, "signatureDerBase64", work->signature_der_base64);
          break;
        case Operation::kDelete:
          CheckNapi(env, napi_get_undefined(env, &result), "create undefined result");
          break;
      }
      CheckNapi(env, napi_resolve_deferred(env, work->deferred, result),
                "resolve device key promise");
    }
  } catch (const std::exception& error) {
    napi_value message = nullptr;
    napi_value rejection = nullptr;
    if (napi_create_string_utf8(env, error.what(), NAPI_AUTO_LENGTH, &message) == napi_ok &&
        napi_create_error(env, nullptr, message, &rejection) == napi_ok) {
      napi_reject_deferred(env, work->deferred, rejection);
    }
  }
  napi_delete_async_work(env, work->async_work);
}

napi_value QueueWork(napi_env env, std::unique_ptr<Work> work, const char* resource_name) {
  napi_value promise = nullptr;
  CheckNapi(env, napi_create_promise(env, &work->deferred, &promise), "create promise");
  napi_value resource = MakeString(env, resource_name);
  CheckNapi(env,
            napi_create_async_work(env, nullptr, resource, ExecuteWork, CompleteWork, work.get(),
                                   &work->async_work),
            "create async device key work");
  CheckNapi(env, napi_queue_async_work(env, work->async_work), "queue async device key work");
  work.release();
  return promise;
}

napi_value CreateDeviceKeyBinding(napi_env env, napi_callback_info information) {
  try {
    size_t count = 1;
    napi_value arguments[1] = {};
    CheckNapi(env, napi_get_cb_info(env, information, &count, arguments, nullptr, nullptr),
              "read createDeviceKey arguments");
    if (count < 1 || !IsString(env, arguments[0])) {
      ThrowTypeError(env, "createDeviceKey requires a protection policy");
      return nullptr;
    }
    const std::string policy = GetString(env, arguments[0]);
    if (policy != kAllowedPolicy && policy != kHardwarePolicy) {
      ThrowTypeError(env, "unsupported device key protection policy");
      return nullptr;
    }
    auto work = std::make_unique<Work>();
    work->env = env;
    work->operation = Operation::kCreate;
    work->policy = policy;
    return QueueWork(env, std::move(work), "createDeviceKey");
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

std::string ReadKeyIdArgument(napi_env env, napi_callback_info information,
                              const char* missing_message) {
  size_t count = 1;
  napi_value arguments[1] = {};
  CheckNapi(env, napi_get_cb_info(env, information, &count, arguments, nullptr, nullptr),
            "read device key arguments");
  if (count < 1 || !IsString(env, arguments[0])) {
    ThrowTypeError(env, missing_message);
    return {};
  }
  const std::string key_id = GetString(env, arguments[0]);
  if (!IsValidKeyId(key_id)) {
    napi_throw_error(env, nullptr, "invalid device key id");
    return {};
  }
  return key_id;
}

napi_value DeleteDeviceKeyBinding(napi_env env, napi_callback_info information) {
  try {
    const std::string key_id =
        ReadKeyIdArgument(env, information, "deleteDeviceKey requires a key id");
    if (key_id.empty()) return nullptr;
    auto work = std::make_unique<Work>();
    work->env = env;
    work->operation = Operation::kDelete;
    work->key_id = key_id;
    return QueueWork(env, std::move(work), "deleteDeviceKey");
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value GetDeviceKeyPublicBinding(napi_env env, napi_callback_info information) {
  try {
    const std::string key_id =
        ReadKeyIdArgument(env, information, "getDeviceKeyPublic requires a key id");
    if (key_id.empty()) return nullptr;
    auto work = std::make_unique<Work>();
    work->env = env;
    work->operation = Operation::kGetPublic;
    work->key_id = key_id;
    return QueueWork(env, std::move(work), "getDeviceKeyPublic");
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

std::vector<unsigned char> ReadPayload(napi_env env, napi_value value) {
  bool is_buffer = false;
  CheckNapi(env, napi_is_buffer(env, value, &is_buffer), "inspect signing payload");
  void* data = nullptr;
  size_t length = 0;
  if (is_buffer) {
    CheckNapi(env, napi_get_buffer_info(env, value, &data, &length), "read signing buffer");
  } else {
    bool is_typed_array = false;
    CheckNapi(env, napi_is_typedarray(env, value, &is_typed_array),
              "inspect signing typed array");
    if (!is_typed_array) {
      ThrowTypeError(env, "signDeviceKey payload must be a Buffer or Uint8Array");
      return {};
    }
    napi_typedarray_type type = napi_uint8_array;
    napi_value array_buffer = nullptr;
    size_t byte_offset = 0;
    CheckNapi(env,
              napi_get_typedarray_info(env, value, &type, &length, &data, &array_buffer,
                                       &byte_offset),
              "read signing typed array");
    if (type != napi_uint8_array && type != napi_uint8_clamped_array) {
      ThrowTypeError(env, "signDeviceKey payload must be a Buffer or Uint8Array");
      return {};
    }
  }
  if (length > kMaximumPayloadBytes) {
    napi_throw_range_error(env, nullptr, "signDeviceKey payload is too large");
    return {};
  }
  if (length == 0) return {};
  const auto* bytes = static_cast<const unsigned char*>(data);
  return std::vector<unsigned char>(bytes, bytes + length);
}

napi_value SignDeviceKeyBinding(napi_env env, napi_callback_info information) {
  try {
    size_t count = 2;
    napi_value arguments[2] = {};
    CheckNapi(env, napi_get_cb_info(env, information, &count, arguments, nullptr, nullptr),
              "read signDeviceKey arguments");
    if (count < 1 || !IsString(env, arguments[0])) {
      ThrowTypeError(env, "signDeviceKey requires a key id");
      return nullptr;
    }
    const std::string key_id = GetString(env, arguments[0]);
    if (!IsValidKeyId(key_id)) {
      napi_throw_error(env, nullptr, "invalid device key id");
      return nullptr;
    }
    if (count < 2) {
      ThrowTypeError(env, "signDeviceKey requires a payload");
      return nullptr;
    }
    std::vector<unsigned char> payload = ReadPayload(env, arguments[1]);
    bool exception_pending = false;
    CheckNapi(env, napi_is_exception_pending(env, &exception_pending),
              "inspect signing payload exception");
    if (exception_pending) return nullptr;
    auto work = std::make_unique<Work>();
    work->env = env;
    work->operation = Operation::kSign;
    work->key_id = key_id;
    work->payload = std::move(payload);
    return QueueWork(env, std::move(work), "signDeviceKey");
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

}  // namespace

NAPI_MODULE_INIT() {
  constexpr napi_property_attributes kMethodAttributes =
      static_cast<napi_property_attributes>(napi_default_method | napi_enumerable);
  napi_property_descriptor properties[] = {
      {"createDeviceKey", nullptr, CreateDeviceKeyBinding, nullptr, nullptr, nullptr,
       kMethodAttributes, nullptr},
      {"deleteDeviceKey", nullptr, DeleteDeviceKeyBinding, nullptr, nullptr, nullptr,
       kMethodAttributes, nullptr},
      {"getDeviceKeyPublic", nullptr, GetDeviceKeyPublicBinding, nullptr, nullptr, nullptr,
       kMethodAttributes, nullptr},
      {"signDeviceKey", nullptr, SignDeviceKeyBinding, nullptr, nullptr, nullptr,
       kMethodAttributes, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]),
                             properties) != napi_ok) {
    napi_throw_error(env, nullptr, "cannot initialize remote-control device key addon");
    return nullptr;
  }
  return exports;
}
