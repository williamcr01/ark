export const RENDERER_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src {{SANDBOX_ORIGIN}}; object-src 'none'; base-uri 'self'; form-action 'none'"

export function getRendererContentSecurityPolicy(sandboxOrigin: string) {
  return RENDERER_CONTENT_SECURITY_POLICY.replace('{{SANDBOX_ORIGIN}}', sandboxOrigin)
}
