import { parse, Lang } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';

export interface EmbeddedSource {
  code: string;
  lang: Lang;
}

function langAttribute(element: SgNode): string | undefined {
  const startTag = element.find({ rule: { kind: 'start_tag' } });
  if (!startTag) return undefined;
  const attrs = startTag.findAll({ rule: { kind: 'attribute' } });
  for (const attr of attrs) {
    const name = attr.find({ rule: { kind: 'attribute_name' } });
    if (name?.text() !== 'lang') continue;
    return attr.find({ rule: { kind: 'attribute_value' } })?.text();
  }
  return undefined;
}

function scriptLang(element: SgNode): Lang {
  const lang = langAttribute(element);
  if (lang === 'ts') return Lang.TypeScript;
  if (lang === 'tsx') return Lang.Tsx;
  return Lang.JavaScript;
}

// Style blocks in a preprocessor language (e.g. `lang="scss"`) aren't CSS, so
// only those without a lang or with `lang="css"` are analysed.
function isCssStyle(element: SgNode): boolean {
  const lang = langAttribute(element);
  return lang === undefined || lang === 'css';
}

// Extracts the contents of every `<script>` and `<style>` block in an
// HTML-like document, such as an HTML page, a Vue component or a Svelte
// component.
export function extractEmbedded(source: string): EmbeddedSource[] {
  const root = parse(Lang.Html, source).root();
  const sources: EmbeddedSource[] = [];
  const elements = root.findAll({
    rule: { any: [{ kind: 'script_element' }, { kind: 'style_element' }] },
  });
  for (const element of elements) {
    const rawText = element.find({ rule: { kind: 'raw_text' } });
    if (!rawText) continue;
    if (element.kind() === 'script_element') {
      sources.push({ code: rawText.text(), lang: scriptLang(element) });
    } else if (isCssStyle(element)) {
      sources.push({ code: rawText.text(), lang: Lang.Css });
    }
  }
  return sources;
}
