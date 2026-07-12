import Anthropic from '@anthropic-ai/sdk'
import type { Ingredient, IngredientCategory } from './types'

export interface ParsedRecipe {
  title: string
  description: string | null
  default_servings: number
  ingredients: Ingredient[]
  instructions: string | null
  source_url: string
  source_image_url: string | null
}

// ─── Category detection ───────────────────────────────────────────────────────

export function detectCategory(name: string): IngredientCategory {
  const n = name.toLowerCase()
  if (/beef|chicken|pork|lamb|salmon|tuna|shrimp|turkey|bacon|ham|sausage|steak|brisket|ground meat|prosciutto|anchov|fish|cod|halibut|tilapia|scallop|crab|lobster|clam|mussel/.test(n)) return 'meat'
  if (/\begg|milk\b|cream\b|butter|cheese|yogurt|parmesan|cheddar|mozzarella|ricotta|brie|gouda|feta|cream cheese|sour cream|half.and.half|whipping cream|heavy cream/.test(n)) return 'dairy'
  if (/flour|sugar|\bsalt\b|pepper\b|olive oil|vegetable oil|canola|coconut oil|vinegar|soy sauce|baking powder|baking soda|cocoa|vanilla|\bpasta\b|\brice\b|\bbread\b|\boats\b|quinoa|lentil|\bbean\b|chickpea|paprika|cumin|coriander|turmeric|cinnamon|nutmeg|cayenne|oregano|broth|stock|tomato (sauce|paste)|honey|maple|mustard|ketchup|mayo|mayonnaise|panko|breadcrumb/.test(n)) return 'pantry'
  if (/frozen/.test(n)) return 'frozen'
  if (/paper towel|plastic wrap|foil|parchment/.test(n)) return 'household'
  if (/onion|garlic|tomato|bell pepper|carrot|celery|lemon|lime|orange|spinach|kale|broccoli|mushroom|zucchini|cucumber|avocado|banana|apple|berry|strawberry|blueberry|raspberry|basil|parsley|cilantro|thyme|rosemary|mint|dill|chive|lettuce|arugula|asparagus|green bean|\bpea\b|corn|potato|sweet potato|squash|eggplant|cauliflower|cabbage|brussels|leek|shallot|scallion|ginger|jalape|habanero|mango|pineapple|peach|grape|cherry|pear|herb|produce/.test(n)) return 'produce'
  return 'other'
}

// ─── Ingredient string parser ─────────────────────────────────────────────────

const UNIT_LIST = [
  'cups?', 'c\\.', 'tablespoons?', 'tbsp\\.?', 'tbs\\.?', 'teaspoons?', 'tsp\\.?',
  'ounces?', 'oz\\.?', 'pounds?', 'lbs?\\.?', 'grams?', '\\bg\\.?\\b',
  'kilograms?', 'kg\\.?', 'milligrams?', 'liters?', 'litres?', '\\bl\\.?\\b',
  'milliliters?', 'millilitres?', 'ml\\.?', 'pints?', 'quarts?', 'gallons?',
  'pinch(?:es)?', 'dash(?:es)?', 'handfuls?', 'bunch(?:es)?', 'cloves?',
  'heads?', 'slices?', 'pieces?', 'cans?', 'jars?', 'packages?', 'pkg\\.?',
  'sticks?', 'sprigs?', 'stalks?',
]

const UNIT_NORMALIZE: Record<string, string> = {
  c: 'cup', cups: 'cup',
  tbsp: 'tablespoon', tbs: 'tablespoon', tablespoons: 'tablespoon',
  tsp: 'teaspoon', teaspoons: 'teaspoon',
  oz: 'ounce', ounces: 'ounce',
  lb: 'pound', lbs: 'pound', pounds: 'pound',
  g: 'gram', grams: 'gram',
  kg: 'kilogram', kilograms: 'kilogram',
  ml: 'milliliter', milliliters: 'milliliter', millilitres: 'milliliter',
  l: 'liter', liters: 'liter', litres: 'liter',
  pkg: 'package', packages: 'package',
}
const UNIT_RE = new RegExp(
  `^([\\d¼½¾⅓⅔⅛⅜⅝⅞][\\d\\s./⁄-]*?)\\s+(${UNIT_LIST.join('|')})(?:\\s+|$)(.*)`,
  'i'
)
const NUM_RE = /^([\d¼½¾⅓⅔⅛⅜⅝⅞][\d./⁄-]*)\s+(.+)$/

function parseIngredient(raw: string): Ingredient {
  const text = raw.trim()

  const unitMatch = text.match(UNIT_RE)
  if (unitMatch) {
    const rawUnit = unitMatch[2].replace(/\.$/, '').toLowerCase()
    return {
      name: unitMatch[3].replace(/^,\s*/, '').trim(),
      quantity: unitMatch[1].trim(),
      unit: UNIT_NORMALIZE[rawUnit] ?? rawUnit,
      category: detectCategory(unitMatch[3]),
      notes: '',
    }
  }

  const numMatch = text.match(NUM_RE)
  if (numMatch) {
    return {
      name: numMatch[2].trim(),
      quantity: numMatch[1].trim(),
      unit: '',
      category: detectCategory(numMatch[2]),
      notes: '',
    }
  }

  return { name: text, quantity: '', unit: '', category: detectCategory(text), notes: '' }
}

// ─── schema.org/Recipe JSON-LD extraction ─────────────────────────────────────

function parseServings(raw: unknown): number {
  if (!raw) return 4
  const s = Array.isArray(raw) ? String(raw[0]) : String(raw)
  const n = parseInt(s.match(/\d+/)?.[0] ?? '4')
  return isNaN(n) || n < 1 ? 4 : n
}

function parseImage(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return parseImage(raw[0])
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    return (obj.url as string) ?? (obj.contentUrl as string) ?? null
  }
  return null
}

function cleanStep(s: string): string {
  return s.replace(/^(step\s*)?\d+[.:)\s]+/i, '').trim()
}

function parseInstructions(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw.trim()
  if (!Array.isArray(raw)) return null

  const steps: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      steps.push(cleanStep(item))
    } else if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>
      if (obj['@type'] === 'HowToSection' && Array.isArray(obj.itemListElement)) {
        for (const step of obj.itemListElement as Record<string, unknown>[]) {
          if (step.text) steps.push(cleanStep(String(step.text)))
        }
      } else if (obj.text) {
        steps.push(cleanStep(String(obj.text)))
      }
    }
  }
  return steps.filter(Boolean).join('\n') || null
}

function schemaToRecipe(r: Record<string, unknown>): ParsedRecipe {
  const rawIngredients = (r.recipeIngredient as string[] | undefined) ?? []
  return {
    title: String(r.name ?? 'Untitled Recipe'),
    description: r.description ? String(r.description) : null,
    default_servings: parseServings(r.recipeYield),
    ingredients: rawIngredients.map(parseIngredient),
    instructions: parseInstructions(r.recipeInstructions),
    source_url: '',
    source_image_url: parseImage(r.image),
  }
}

function extractJsonLd(html: string): ParsedRecipe | null {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1])
      const nodes: Record<string, unknown>[] = Array.isArray(json)
        ? json
        : json['@graph']
        ? json['@graph']
        : [json]

      for (const node of nodes) {
        const type = node['@type']
        const isRecipe =
          type === 'Recipe' ||
          (Array.isArray(type) && type.includes('Recipe'))
        if (isRecipe) return schemaToRecipe(node)
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null
}

// ─── Pinterest resolution ─────────────────────────────────────────────────────

async function resolvePinterest(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  })
  const html = await res.text()

  // Pinterest embeds the outbound URL in several places
  const patterns = [
    /"website_url"\s*:\s*"([^"]+)"/,
    /"link"\s*:\s*"(https?:[^"]+)"/,
    /<meta[^>]+property="og:see_also"[^>]+content="([^"]+)"/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      const candidate = decodeURIComponent(m[1])
      if (!candidate.includes('pinterest.com')) return candidate
    }
  }

  throw new Error(
    'Could not find the recipe link from this Pinterest pin. Open the pin, tap through to the recipe page, and paste that URL instead.'
  )
}

// ─── Claude Haiku fallback ────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

// Cloudflare and similar services return a JS challenge page when they block a request.
// Detect it early so we can give a useful error rather than "no recipe found".
function isBotChallenge(html: string): boolean {
  return (
    /cf-browser-verification|cf-challenge|jschl[-_]answer|checking your browser/i.test(html) ||
    (/cloudflare/i.test(html) && html.length < 10000)
  )
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 48000)
}

async function parseWithClaude(html: string, url: string): Promise<ParsedRecipe | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const text = stripHtml(html)

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Extract the recipe from this webpage. Return ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "title": "string",
  "description": "string or null",
  "default_servings": number,
  "ingredients": [{"name":"string","quantity":"string","unit":"string","category":"produce|dairy|meat|pantry|frozen|household|other|","notes":"string"}],
  "instructions": "step 1 text\\nstep 2 text\\n...",
  "source_image_url": "absolute URL or null"
}

Webpage text:
${text}`,
      },
    ],
  })

  const block = response.content[0]
  if (block.type !== 'text') return null

  try {
    const jsonMatch = block.text.match(/\{[\s\S]+\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as ParsedRecipe
    parsed.source_url = url
    return parsed
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseRecipeUrl(
  url: string
): Promise<{ recipe: ParsedRecipe; source: 'json-ld' | 'claude' }> {
  // Resolve Pinterest pins to the actual recipe page
  let targetUrl = url
  if (/pinterest\.com|pin\.it/i.test(url)) {
    targetUrl = await resolvePinterest(url)
  }

  const res = await fetch(targetUrl, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(
      `Could not fetch that page (${res.status}). Check the URL and try again.`
    )
  }

  const html = await res.text()

  if (isBotChallenge(html)) {
    throw new Error(
      "We couldn't load this recipe — the website is blocking us. Try opening the recipe directly in Safari or Chrome, then copy the URL from the address bar and paste that instead."
    )
  }

  const jsonLd = extractJsonLd(html)
  if (jsonLd) {
    jsonLd.source_url = targetUrl
    return { recipe: jsonLd, source: 'json-ld' }
  }

  const claude = await parseWithClaude(html, targetUrl)
  if (claude) return { recipe: claude, source: 'claude' }

  throw new Error(
    'No recipe found on this page. Make sure the URL points to an actual recipe, not a category or search page.'
  )
}
