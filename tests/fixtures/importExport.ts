/** Small boundary fixtures shared by the Office import/export regression tests. */
export const EMPTY_BYTES = new Uint8Array();
export const MALFORMED_OFFICE_BYTES = new TextEncoder().encode('not an Office document');
