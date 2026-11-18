import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { allowedUrl } from '../src/url-policy.mjs'

test('allows GitHub over HTTPS and the local test server', () => {
  for (const url of ['https://github.com/login', 'https://gist.github.com/', 'http://127.0.0.1:18739/check']) assert.equal(allowedUrl(url), true, url)
})

test('rejects deceptive domains, credentials, other ports and unsafe protocols', () => {
  for (const url of ['https://github.com.evil.test/', 'https://evil-github.com/', 'https://user:pass@github.com/', 'https://github.com:8443/', 'http://github.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://127.0.0.1:18740/', 'invalid']) assert.equal(allowedUrl(url), false, url)
})
