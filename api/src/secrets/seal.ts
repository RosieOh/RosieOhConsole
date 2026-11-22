import { createRequire } from 'node:module';

// GitHub Actions 시크릿 봉인 — 저장소(또는 조직) 공개키로 libsodium sealed box(crypto_box_seal).
// GitHub 은 봉인된 값만 받는다: https://docs.github.com/rest/guides/encrypting-secrets-for-the-rest-api
// libsodium-wrappers 의 ESM 빌드는 파일이 빠져 있어(0.7.x) CommonJS 빌드를 불러 쓴다.
type Sodium = typeof import('libsodium-wrappers');
let sodium: Promise<Sodium> | null = null;
const load = () => (sodium ??= (async () => {
  const s = createRequire(import.meta.url)('libsodium-wrappers') as Sodium;
  await s.ready;
  return s;
})());

/** 값 → GitHub 이 받는 encrypted_value(base64). publicKey 는 GitHub 이 준 base64 공개키 */
export async function sealSecret(value: string, publicKey: string): Promise<string> {
  const s = await load();
  const key = s.from_base64(publicKey, s.base64_variants.ORIGINAL);
  if (key.length !== s.crypto_box_PUBLICKEYBYTES) throw new Error('공개키 길이가 맞지 않습니다');
  return s.to_base64(s.crypto_box_seal(s.from_string(value), key), s.base64_variants.ORIGINAL);
}

/** 시험용 — 봉인을 다시 연다 */
export async function _openSealed(sealed: string, publicKey: Uint8Array, privateKey: Uint8Array): Promise<string> {
  const s = await load();
  return s.to_string(s.crypto_box_seal_open(s.from_base64(sealed, s.base64_variants.ORIGINAL), publicKey, privateKey));
}
export async function _keypair() { const s = await load(); const k = s.crypto_box_keypair(); return { ...k, publicB64: s.to_base64(k.publicKey, s.base64_variants.ORIGINAL) }; }
