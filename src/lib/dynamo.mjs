/**
 * Database adapter — DynamoDB with local JSON file fallback.
 * Adapted from aip-registry/src/lib/db.mjs for forkless multi-tenant tables.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const isLocal = (process.env.FORKLESS_STORAGE || 'local') === 'local';
const DATA_DIR = join(process.cwd(), 'data');
const prefix = process.env.TABLE_PREFIX || 'forkless';

// ─── Local JSON file storage ────────────────────────────────────

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function localPath(table) {
  ensureDataDir();
  return join(DATA_DIR, `${table}.json`);
}

function readTable(table) {
  const path = localPath(table);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeTable(table, items) {
  writeFileSync(localPath(table), JSON.stringify(items, null, 2));
}

// ─── DynamoDB client (lazy-loaded) ──────────────────────────────

let ddbDocClient = null;

async function getDDB() {
  if (ddbDocClient) return ddbDocClient;
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  ddbDocClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return ddbDocClient;
}

export function tableName(short) {
  return `${prefix}-${short}`;
}

// ─── Public API ─────────────────────────────────────────────────

export async function getItem(table, key) {
  if (isLocal) {
    const items = readTable(table);
    return items.find(item =>
      Object.entries(key).every(([k, v]) => item[k] === v)
    ) || null;
  }

  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();
  const { Item } = await ddb.send(new GetCommand({
    TableName: tableName(table),
    Key: key,
  }));
  return Item || null;
}

export async function putItem(table, item) {
  if (isLocal) {
    const items = readTable(table);
    const pkFields = getPkFields(table);
    const idx = items.findIndex(existing =>
      pkFields.every(k => existing[k] === item[k])
    );
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    writeTable(table, items);
    return item;
  }

  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();
  await ddb.send(new PutCommand({
    TableName: tableName(table),
    Item: item,
  }));
  return item;
}

export async function deleteItem(table, key) {
  if (isLocal) {
    const items = readTable(table);
    const filtered = items.filter(item =>
      !Object.entries(key).every(([k, v]) => item[k] === v)
    );
    writeTable(table, filtered);
    return;
  }

  const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();
  await ddb.send(new DeleteCommand({
    TableName: tableName(table),
    Key: key,
  }));
}

export async function queryItems(table, opts = {}) {
  const { pk, pkValue, sk, skValue, skBeginsWith, index, limit, scanForward = true } = opts;

  if (isLocal) {
    let items = readTable(table);
    if (pk && pkValue !== undefined) {
      items = items.filter(item => item[pk] === pkValue);
    }
    if (sk && skValue !== undefined) {
      items = items.filter(item => item[sk] === skValue);
    }
    if (sk && skBeginsWith !== undefined) {
      items = items.filter(item => item[sk] && item[sk].startsWith(skBeginsWith));
    }
    if (!scanForward) items.reverse();
    if (limit) items = items.slice(0, limit);
    return items;
  }

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();

  const params = {
    TableName: tableName(table),
    ScanIndexForward: scanForward,
  };
  if (index) params.IndexName = index;
  if (limit) params.Limit = limit;

  let expr = '#pk = :pkVal';
  const names = { '#pk': pk };
  const values = { ':pkVal': pkValue };

  if (sk && skValue !== undefined) {
    expr += ' AND #sk = :skVal';
    names['#sk'] = sk;
    values[':skVal'] = skValue;
  } else if (sk && skBeginsWith !== undefined) {
    expr += ' AND begins_with(#sk, :skPrefix)';
    names['#sk'] = sk;
    values[':skPrefix'] = skBeginsWith;
  }

  params.KeyConditionExpression = expr;
  params.ExpressionAttributeNames = names;
  params.ExpressionAttributeValues = values;

  const { Items } = await ddb.send(new QueryCommand(params));
  return Items || [];
}

/**
 * Query by partition key only — convenience for GSI queries.
 */
export async function queryByPk(table, pk, pkValue, opts = {}) {
  return queryItems(table, { pk, pkValue, ...opts });
}

export async function scanItems(table, opts = {}) {
  const { limit, lastKey, filterField, filterValue } = opts;

  if (isLocal) {
    let items = readTable(table);
    if (filterField && filterValue !== undefined) {
      items = items.filter(item => item[filterField] === filterValue);
    }
    const startIdx = lastKey ? items.findIndex(i =>
      Object.entries(lastKey).every(([k, v]) => i[k] === v)
    ) + 1 : 0;
    const sliced = limit ? items.slice(startIdx, startIdx + limit) : items.slice(startIdx);
    const hasMore = limit ? (startIdx + limit) < items.length : false;
    return { items: sliced, lastKey: hasMore ? sliced[sliced.length - 1] : null };
  }

  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();

  const params = { TableName: tableName(table) };
  if (limit) params.Limit = limit;
  if (lastKey) params.ExclusiveStartKey = lastKey;
  if (filterField && filterValue !== undefined) {
    params.FilterExpression = '#ff = :fv';
    params.ExpressionAttributeNames = { '#ff': filterField };
    params.ExpressionAttributeValues = { ':fv': filterValue };
  }

  const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand(params));
  return { items: Items || [], lastKey: LastEvaluatedKey || null };
}

export async function updateItem(table, key, updates) {
  if (isLocal) {
    const item = await getItem(table, key);
    if (!item) return null;
    const merged = { ...item, ...updates };
    await putItem(table, merged);
    return merged;
  }

  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();

  const entries = Object.entries(updates);
  const expr = 'SET ' + entries.map((_, i) => `#f${i} = :v${i}`).join(', ');
  const names = {};
  const values = {};
  entries.forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
  });

  const { Attributes } = await ddb.send(new UpdateCommand({
    TableName: tableName(table),
    Key: key,
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));
  return Attributes;
}

/**
 * Batch write items (max 25 per call).
 */
export async function batchWrite(table, putItems = [], deleteKeys = []) {
  if (isLocal) {
    for (const item of putItems) await putItem(table, item);
    for (const key of deleteKeys) await deleteItem(table, key);
    return;
  }

  const { BatchWriteCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = await getDDB();
  const tbl = tableName(table);

  const requests = [
    ...putItems.map(item => ({ PutRequest: { Item: item } })),
    ...deleteKeys.map(key => ({ DeleteRequest: { Key: key } })),
  ];

  // DynamoDB batch write limit is 25
  for (let i = 0; i < requests.length; i += 25) {
    const batch = requests.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [tbl]: batch },
    }));
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function getPkFields(table) {
  const map = {
    tenants: ['tenant_id'],
    conversations: ['tenant_id', 'conversation_id'],
    'board-items': ['tenant_id', 'item_id'],
    'board-comments': ['tenant_id', 'comment_id'],
    'board-decisions': ['tenant_id', 'decision_id'],
    'journey-states': ['tenant_id', 'journey_id'],
    'scheduler-events': ['tenant_id', 'event_id'],
    'faq-cache': ['tenant_id', 'question_hash'],
    users: ['tenant_id', 'email'],
    otp: ['tenant_id', 'email'],
    artifacts: ['tenant_id', 'artifact_id'],
    connections: ['connection_id'],
  };
  return map[table] || ['id'];
}
