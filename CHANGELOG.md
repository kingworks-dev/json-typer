# Changelog

## 1.0.0
- First release. Generate types from JSON: TypeScript, Go and JSON Schema free; Zod, Python (dataclass and Pydantic), Rust (serde), C# and Kotlin with Pro.
- Merges arrays of objects into one type; fields missing in some items become optional; null becomes nullable.
- Accepts JSON with comments, trailing commas and a leading `const x =`.
- Works offline. No telemetry, no network access.
