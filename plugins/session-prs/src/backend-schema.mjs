import { Schema } from "effect"

// Desktop windows and the main process can briefly run different plugin
// versions during reload. Older windows send only a directory or omit the
// historical locations; the backend must accept both without rejecting them.
export const backendReadInput = Schema.Struct({
  directory: Schema.String,
  directories: Schema.optional(Schema.Array(Schema.String)),
  urls: Schema.optional(Schema.Array(Schema.String)),
})
