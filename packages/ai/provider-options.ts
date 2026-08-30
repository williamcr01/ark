type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** AI SDK `providerOptions` bag: provider key -> JSON-serializable options. */
export type ProviderOptions = Record<string, { [key: string]: JsonValue }>
