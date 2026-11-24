export function execFile() { throw new Error('Native commands are disabled in the visual fixture.') }
export function promisify() { return async () => { throw new Error('Native commands are disabled in the visual fixture.') } }
