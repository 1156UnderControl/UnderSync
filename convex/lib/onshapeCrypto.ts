const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(keyValue: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(keyValue);
  if (bytes.byteLength !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must contain exactly 32 bytes.");
  return await crypto.subtle.importKey("raw", bytes.buffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function randomOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(state));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function encryptIntegrationSecret(value: string, keyValue: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(keyValue),
    encoder.encode(value),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptIntegrationSecret(value: string, keyValue: string): Promise<string> {
  const [version, iv, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !encrypted) throw new Error("Unsupported encrypted integration secret.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv).buffer },
    await encryptionKey(keyValue),
    base64UrlToBytes(encrypted).buffer,
  );
  return decoder.decode(decrypted);
}
