// Fake GUI host: no GitHub access, credentials, or agent requests.
export const Plugin = { define: (value: any) => value }
export const Contract = { define: (id: string) => ({ id }) }
export const Ipc = { define: (value: any) => value }
export const Command = Symbol('Command'), LinkHandler = Symbol('LinkHandler'), Panel = Symbol('Panel'), Style = Symbol('Style'), MenuItem = Symbol('MenuItem')
export const Browser = { id: 'browser' }
export const Schema = { String: {}, Unknown: {}, Struct: (value: any) => value, Array: (value: any) => value, optional: (value: any) => value }
