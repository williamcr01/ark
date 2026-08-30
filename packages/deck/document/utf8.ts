const encoder = new TextEncoder()

/** Byte length of a string in UTF-8, without depending on Node's `Buffer`. */
export function utf8ByteLength(value: string) {
  return encoder.encode(value).length
}
