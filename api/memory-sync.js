/**
 * api/memory-sync.js — Edge Function (Vercel)
 *
 * Backend para Fase B: sync de índice cifrado entre dispositivos.
 * Armazena blobs opacos (AES-GCM ciphertext) no Cloudflare R2.
 * O servidor nunca vê dados em claro — a chave fica no navegador.
 *
 * Docs: docs/HYBRID_MEMORY_PLAN.md, seção B
 */

export const config = { runtime: 'edge' };

// Instancia o cliente S3 (R2 é S3-compatible)
function initR2Client() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKey = process.env.CLOUDFLARE_R2_KEY;
  const secretKey = process.env.CLOUDFLARE_R2_SECRET;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET || 'jarvis-memory-index';

  if (!accountId || !accessKey || !secretKey) {
    throw new Error(
      'Cloudflare R2 não configurado. Defina: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_KEY, CLOUDFLARE_R2_SECRET'
    );
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return { endpoint, accessKey, secretKey, bucket };
}

/**
 * Assina uma requisição S3 com AWS SigV4 (RFC 4104)
 * Compatível com R2 e S3
 */
function signS3Request(method, bucket, key, body = null, r2Config) {
  const amzDate = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');
  const dateStamp = amzDate.slice(0, 8);

  // Canonical request
  const payloadHash = hashSHA256(body || '');
  const canonicalUri = `/${bucket}/${key}`;
  const canonicalQuerystring = '';
  const canonicalHeaders = `host:${r2Config.endpoint.replace('https://', '')}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  // String to sign
  const canonicalRequestHash = hashSHA256(canonicalRequest);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  // Signature
  const kDate = hmacSHA256(`AWS4${r2Config.secretKey}`, dateStamp);
  const kRegion = hmacSHA256(kDate, 'auto');
  const kService = hmacSHA256(kRegion, 's3');
  const kSigning = hmacSHA256(kService, 'aws4_request');
  const signature = hmacSHA256(kSigning, stringToSign);

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${r2Config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      'Host': r2Config.endpoint.replace('https://', ''),
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Authorization': authorizationHeader,
      'Content-Type': 'application/octet-stream',
    },
    amzDate,
    dateStamp,
  };
}

// Helpers para SHA256/HMAC (usando SubtleCrypto da Vercel Edge)
function hashSHA256(data) {
  // Simplificado: em produção, usar crypto.subtle
  // Por enquanto, placeholder que o edge runtime suporta
  const encoder = new TextEncoder();
  return Buffer.from(data).toString('hex').slice(0, 64); // fake, replace com real hash
}

function hmacSHA256(key, data) {
  // Placeholder
  return 'xxxxxxxx';
}

/**
 * GET /api/memory-sync?deviceId=<uuid>
 * Recupera o índice criptografado mais recente do R2
 * Resposta: { ciphertext, salt, iv, updatedAt, deviceId }
 */
async function handleGet(req, r2Config) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId') || 'default';
  const indexKey = `memory-index/${deviceId}.json`;

  try {
    const r2Url = `${r2Config.endpoint}/${r2Config.bucket}/${indexKey}`;
    const response = await fetch(r2Url, { method: 'GET' });

    if (response.status === 404) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!response.ok) {
      console.error(JSON.stringify({
        event: 'r2_get_error',
        status: response.status,
        deviceId,
      }));
      return new Response(JSON.stringify({ error: 'r2_error' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const blob = await response.arrayBuffer();
    const data = JSON.parse(new TextDecoder().decode(blob));

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'memory_sync_get_error',
      message: err.message,
      deviceId,
    }));
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * PUT /api/memory-sync
 * Armazena o índice criptografado no R2
 * Body: { version, createdAt, updatedAt, deviceId, ciphertext, salt, iv }
 */
async function handlePut(req, r2Config) {
  try {
    const body = await req.json();
    const { deviceId, ciphertext, salt, iv } = body;

    if (!deviceId || !ciphertext || !salt || !iv) {
      return new Response(JSON.stringify({ error: 'missing_fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const indexKey = `memory-index/${deviceId}.json`;
    const payload = JSON.stringify(body);

    // Assinar requisição S3 PUT
    const signed = signS3Request('PUT', r2Config.bucket, indexKey, payload, r2Config);
    const r2Url = `${r2Config.endpoint}/${r2Config.bucket}/${indexKey}`;

    const putResponse = await fetch(r2Url, {
      method: 'PUT',
      headers: {
        ...signed.headers,
        'Content-Length': new TextEncoder().encode(payload).length,
      },
      body: payload,
    });

    if (!putResponse.ok) {
      console.error(JSON.stringify({
        event: 'r2_put_error',
        status: putResponse.status,
        deviceId,
        body: await putResponse.text(),
      }));
      return new Response(JSON.stringify({ error: 'r2_put_failed' }), {
        status: putResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(JSON.stringify({
      event: 'memory_sync_push',
      deviceId,
      size: payload.length,
      timestamp: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({ success: true, updatedAt: body.updatedAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'memory_sync_put_error',
      message: err.message,
    }));
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handler principal
 */
export default async function handler(req) {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const r2Config = initR2Client();

    if (req.method === 'GET') {
      return await handleGet(req, r2Config);
    } else if (req.method === 'PUT') {
      return await handlePut(req, r2Config);
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: 'memory_sync_handler_error',
      message: err.message,
    }));
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
