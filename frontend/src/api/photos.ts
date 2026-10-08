// The w3 unified profile service, which is *not* a Bluepages path - photos exist on
// neither SLAPHAPI nor WSAPI (the ibmperson schema carries no photo attribute at all),
// so this is a separate host with its own URL grammar. It needs no auth.
const PHOTO_BASE_URL = 'https://w3-unified-profile-api.ibm.com/v3/image'

/**
 * Builds the profile-photo URL for an employee id (CNUM).
 *
 * `size` is the pixel edge the service resizes to server-side; the source is a 400x400
 * square, so the result is `size` x `size`. Callers pass twice their rendered box so the
 * bitmap stays crisp on HiDPI - the cost is trivial (s=96 is ~2.3KB).
 *
 * `def=none` is load-bearing: by default the service answers an employee with no photo
 * with a grey silhouette at 200, which is indistinguishable from a real photo without
 * comparing bytes. `def=none` makes that case a 404 instead, so an <img> onError handler
 * can fall back to initials. It is implemented but undocumented - the service's own
 * error message lists only `avatar|init|blue|null` - so if it is ever tightened to a 400
 * the symptom is a grey silhouette where initials belong, not a broken image.
 */
export function getPhotoUrl(id: string, size: number): string {
  return `${PHOTO_BASE_URL}/${encodeURIComponent(id)}?def=none&s=${size}`
}
