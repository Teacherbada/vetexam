// Session-scoped temporary fixtures need a direct backend, not Neon transaction pooling.
export function diagnosticTestConnectionString() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace(/-pooler(?=\.)/, '');
  return url.toString();
}
