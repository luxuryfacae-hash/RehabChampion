--[[
  api.lua — RehabChampion backend HTTP client.

  Posts HMAC-signed JSON to the backend from the Dota VScript VM via
  CreateHTTPRequestScriptVM. The shared secret and base URL are config
  constants below; the secret MUST match the backend's HMAC_SECRET env var.

  Cannot be unit-tested off-engine (no CreateHTTPRequestScriptVM outside Dota).
  See test/api.test.ts for the server side that validates the same signature.
]]

Api = Api or {}

-- ── Config ──────────────────────────────────────────────────────────────────
local API_BASE_URL = "http://127.0.0.1:3000"
local API_HMAC_SECRET = "change-me-to-a-long-random-string"

-- ── HMAC-SHA256 (hex) ─────────────────────────────────────────────────────────
-- Pure-Lua SHA-256 + HMAC so the signature matches Node's
-- crypto.createHmac("sha256", secret).update(body).digest("hex").

local band, bor, bxor, bnot, rshift, lshift
if bit then
  band, bor, bxor, bnot = bit.band, bit.bor, bit.bxor, bit.bnot
  rshift, lshift = bit.rshift, bit.lshift
else
  -- 32-bit software fallback.
  local function tobits(a) return a % 0x100000000 end
  band = function(a, b)
    local r, p = 0, 1
    a, b = tobits(a), tobits(b)
    for _ = 1, 32 do
      if (a % 2 == 1) and (b % 2 == 1) then r = r + p end
      a, b, p = math.floor(a / 2), math.floor(b / 2), p * 2
    end
    return r
  end
  bor = function(a, b)
    local r, p = 0, 1
    a, b = tobits(a), tobits(b)
    for _ = 1, 32 do
      if (a % 2 == 1) or (b % 2 == 1) then r = r + p end
      a, b, p = math.floor(a / 2), math.floor(b / 2), p * 2
    end
    return r
  end
  bxor = function(a, b)
    local r, p = 0, 1
    a, b = tobits(a), tobits(b)
    for _ = 1, 32 do
      if (a % 2) ~= (b % 2) then r = r + p end
      a, b, p = math.floor(a / 2), math.floor(b / 2), p * 2
    end
    return r
  end
  bnot = function(a) return 0xFFFFFFFF - tobits(a) end
  rshift = function(a, n) return math.floor(tobits(a) / (2 ^ n)) end
  lshift = function(a, n) return tobits(a * (2 ^ n)) end
end

local function rrotate(x, n)
  return band(bor(rshift(x, n), lshift(x, 32 - n)), 0xFFFFFFFF)
end

local K = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}

local function sha256_bin(msg)
  local h = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  }
  local len = #msg
  msg = msg .. "\128"
  while (#msg % 64) ~= 56 do msg = msg .. "\0" end
  local bitlen = len * 8
  for i = 7, 0, -1 do
    msg = msg .. string.char(band(rshift(bitlen, i * 8), 0xFF))
  end

  for chunk = 1, #msg, 64 do
    local w = {}
    for i = 0, 15 do
      local j = chunk + i * 4
      w[i] = bor(
        lshift(string.byte(msg, j), 24),
        lshift(string.byte(msg, j + 1), 16),
        lshift(string.byte(msg, j + 2), 8),
        string.byte(msg, j + 3)
      )
    end
    for i = 16, 63 do
      local s0 = bxor(bxor(rrotate(w[i - 15], 7), rrotate(w[i - 15], 18)), rshift(w[i - 15], 3))
      local s1 = bxor(bxor(rrotate(w[i - 2], 17), rrotate(w[i - 2], 19)), rshift(w[i - 2], 10))
      w[i] = band(w[i - 16] + s0 + w[i - 7] + s1, 0xFFFFFFFF)
    end

    local a, b, c, d, e, f, g, hh = h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]
    for i = 0, 63 do
      local S1 = bxor(bxor(rrotate(e, 6), rrotate(e, 11)), rrotate(e, 25))
      local ch = bxor(band(e, f), band(bnot(e), g))
      local t1 = band(hh + S1 + ch + K[i + 1] + w[i], 0xFFFFFFFF)
      local S0 = bxor(bxor(rrotate(a, 2), rrotate(a, 13)), rrotate(a, 22))
      local maj = bxor(bxor(band(a, b), band(a, c)), band(b, c))
      local t2 = band(S0 + maj, 0xFFFFFFFF)
      hh, g, f, e = g, f, e, band(d + t1, 0xFFFFFFFF)
      d, c, b, a = c, b, a, band(t1 + t2, 0xFFFFFFFF)
    end

    h[1] = band(h[1] + a, 0xFFFFFFFF)
    h[2] = band(h[2] + b, 0xFFFFFFFF)
    h[3] = band(h[3] + c, 0xFFFFFFFF)
    h[4] = band(h[4] + d, 0xFFFFFFFF)
    h[5] = band(h[5] + e, 0xFFFFFFFF)
    h[6] = band(h[6] + f, 0xFFFFFFFF)
    h[7] = band(h[7] + g, 0xFFFFFFFF)
    h[8] = band(h[8] + hh, 0xFFFFFFFF)
  end

  local out = {}
  for i = 1, 8 do
    for s = 24, 0, -8 do
      out[#out + 1] = string.char(band(rshift(h[i], s), 0xFF))
    end
  end
  return table.concat(out)
end

local function tohex(bin)
  return (bin:gsub(".", function(c) return string.format("%02x", string.byte(c)) end))
end

local function hmac_sha256_hex(secret, message)
  local blocksize = 64
  if #secret > blocksize then secret = sha256_bin(secret) end
  secret = secret .. string.rep("\0", blocksize - #secret)
  local o_pad, i_pad = {}, {}
  for i = 1, blocksize do
    local b = string.byte(secret, i)
    o_pad[i] = string.char(bxor(b, 0x5c))
    i_pad[i] = string.char(bxor(b, 0x36))
  end
  o_pad = table.concat(o_pad)
  i_pad = table.concat(i_pad)
  return tohex(sha256_bin(o_pad .. sha256_bin(i_pad .. message)))
end

-- ── Public API ──────────────────────────────────────────────────────────────

--- POST a JSON payload to the backend with an HMAC signature header.
-- @param path string  e.g. "/item/pickup"
-- @param payload table  JSON-encodable Lua table
-- @param cb function|nil  called with (ok:boolean, decoded:table|nil, statusCode:number, rawBody:string)
function Api:Post(path, payload, cb)
  local body = json.encode(payload)
  local sig = hmac_sha256_hex(API_HMAC_SECRET, body)
  local url = API_BASE_URL .. path

  local req = CreateHTTPRequestScriptVM("POST", url)
  req:SetHTTPRequestHeaderValue("Content-Type", "application/json")
  req:SetHTTPRequestHeaderValue("X-Signature", sig)
  req:SetHTTPRequestRawPostBody("application/json", body)

  req:Send(function(result)
    local status = result.StatusCode or 0
    local raw = result.Body or ""
    local ok = status >= 200 and status < 300
    local decoded = nil
    if raw ~= "" then
      local success, parsed = pcall(json.decode, raw)
      if success then decoded = parsed end
    end
    if not ok then
      print(string.format("[Api] POST %s failed (status %d): %s", path, status, raw))
    end
    if cb then cb(ok, decoded, status, raw) end
  end)
end

return Api
