import type { FileDetail } from '../types.js';
import { expandTags } from '../search/synonyms.js';

const VALID_LAYERS = new Set(['view', 'viewmodel', 'model', 'api', 'util', 'config', 'test', 'other']);
const VALID_KINDS = new Set(['view', 'client', 'repository', 'service', 'model', 'extension', 'config', 'test', 'usecase', 'other']);

const MODULE_ALIASES = new Map<string, string>([
  ['api', 'API'],
  ['auth', 'Auth'],
  ['authentication', 'Auth'],
  ['basket', 'Basket'],
  ['cart', 'Basket'],
  ['composeapp', 'ComposeApp'],
  ['core', 'Core'],
  ['data', 'Data'],
  ['di', 'DI'],
  ['docs', 'Docs'],
  ['documentation', 'Docs'],
  ['domain', 'Domain'],
  ['iosapp', 'IosApp'],
  ['network', 'Network'],
  ['networking', 'Network'],
  ['platform', 'Platform'],
  ['providers', 'Providers'],
  ['recipe', 'Recipes'],
  ['recipes', 'Recipes'],
  ['shared', 'Shared'],
  ['shoppinglist', 'ShoppingList'],
  ['shopping-list', 'ShoppingList'],
  ['test', 'Tests'],
  ['tests', 'Tests'],
  ['types', 'Types'],
  ['ui', 'UI'],
  ['util', 'Util'],
  ['utils', 'Util'],
]);

const GENERIC_MODULES = new Set([
  'API',
  'Config',
  'Data',
  'DI',
  'Domain',
  'Model',
  'Network',
  'Platform',
  'Providers',
  'Shared',
  'Tests',
  'UI',
  'Util',
]);

const PATH_MODULES = new Map<string, string>([
  ['composeApp', 'ComposeApp'],
  ['core', 'Core'],
  ['iosApp', 'IosApp'],
  ['recipes', 'Recipes'],
  ['shared', 'Shared'],
  ['shoppinglist', 'ShoppingList'],
]);

const LAYER_ALIASES = new Map<string, string>([
  ['api client', 'api'],
  ['client', 'api'],
  ['configuration', 'config'],
  ['configs', 'config'],
  ['data', 'model'],
  ['domain', 'model'],
  ['network', 'api'],
  ['networking', 'api'],
  ['repository', 'api'],
  ['screen', 'view'],
  ['service', 'api'],
  ['tests', 'test'],
  ['ui', 'view'],
  ['usecase', 'model'],
  ['use case', 'model'],
  ['view model', 'viewmodel'],
  ['view-model', 'viewmodel'],
]);

const KIND_ALIASES = new Map<string, string>([
  ['api', 'client'],
  ['api client', 'client'],
  ['configuration', 'config'],
  ['configs', 'config'],
  ['data source', 'repository'],
  ['datasource', 'repository'],
  ['dto', 'model'],
  ['entity', 'model'],
  ['interface', 'model'],
  ['interactor', 'usecase'],
  ['resource', 'client'],
  ['screen', 'view'],
  ['tests', 'test'],
  ['use case', 'usecase'],
  ['use-case', 'usecase'],
  ['usecase', 'usecase'],
  ['view model', 'view'],
  ['view-model', 'view'],
  ['viewmodel', 'view'],
]);

export function normalizeFileDetail(detail: FileDetail): FileDetail {
  const module = normalizeModule(detail.module, detail.path);
  const layer = normalizeLayer(detail.layer);
  const kind = normalizeKind(detail.kind, detail.path);
  const tags = normalizeTags([
    ...detail.tags,
    module,
    layer,
    kind,
    ...detail.description.split(/\s+/),
  ]);

  return {
    ...detail,
    module,
    layer,
    kind,
    description: normalizeDescription(detail.description),
    tags,
  };
}

export function normalizeModule(raw: string | undefined, relativePath: string): string {
  const inferred = inferModuleFromPath(relativePath);
  const normalized = canonicalModule(raw);

  if (!normalized || normalized === 'Root') {
    return inferred ?? 'Root';
  }

  if (inferred && GENERIC_MODULES.has(normalized)) {
    return inferred;
  }

  return normalized;
}

export function normalizeLayer(raw: string | undefined): string {
  const value = normalizeToken(raw);
  const aliased = LAYER_ALIASES.get(value) ?? value;
  return VALID_LAYERS.has(aliased) ? aliased : 'other';
}

export function normalizeKind(raw: string | undefined, relativePath: string): string {
  const value = normalizeToken(raw);
  const aliased = KIND_ALIASES.get(value) ?? value;
  if (VALID_KINDS.has(aliased)) return aliased;

  const path = relativePath.toLowerCase();
  if (path.includes('/test/') || path.endsWith('test.kt') || path.endsWith('.test.ts')) return 'test';
  if (path.includes('/repository/') || path.includes('/repositories/') || path.endsWith('repository.kt')) return 'repository';
  if (path.includes('/datasource/') || path.includes('/data-source/')) return 'repository';
  if (path.includes('/usecase/') || path.endsWith('usecase.kt')) return 'usecase';
  if (path.includes('/service/') || path.endsWith('service.kt')) return 'service';
  if (path.includes('/api/') || path.includes('/resources/')) return 'client';
  if (path.includes('/model/') || path.includes('/models/') || path.includes('/dto/')) return 'model';
  if (path.includes('/viewmodel/') || path.endsWith('viewmodel.kt')) return 'view';
  if (path.includes('/di/')) return 'config';

  return 'other';
}

function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .flatMap((tag) => {
      const token = normalizeToken(tag);
      return token ? [token, ...token.split(/[\s,;/]+/)] : [];
    })
    .filter((tag) => tag.length > 1 && tag !== 'other');

  return [...new Set(expandTags(normalized))].slice(0, 16);
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

function canonicalModule(raw: string | undefined): string | null {
  const token = normalizeToken(raw);
  if (!token) return null;

  const alias = MODULE_ALIASES.get(token);
  if (alias) return alias;

  return token
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function inferModuleFromPath(relativePath: string): string | null {
  const first = relativePath.split('/')[0];
  if (!first || first === relativePath) return null;
  return PATH_MODULES.get(first) ?? null;
}

function normalizeToken(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
