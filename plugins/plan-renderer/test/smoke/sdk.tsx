// Browser-only fake host: exercises the actual Solid component without sending agent requests.
export const Plugin = { define: (value: any) => value }
export const Contract = { define: (id: string) => ({ id }) }
export const Command = Symbol('Command'), LinkHandler = Symbol('LinkHandler'), Panel = Symbol('Panel'), Style = Symbol('Style')
