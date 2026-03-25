import { marked } from "marked";

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "ul"
]);

const ALLOWED_STYLES = new Set([
  "background-color",
  "color",
  "font-style",
  "font-weight",
  "text-decoration"
]);

const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|#)/i;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const PLAIN_URL_PATTERN = /(^|[\s(（])((https?:\/\/|mailto:|tel:)[^\s<>\u3000]+)/gi;
const FOOTNOTE_DEFINITION_PATTERN = /^\[\^([^\]]+)\]:\s*(.+)$/gm;
const FOOTNOTE_REFERENCE_PATTERN = /\[\^([^\]]+)\]/g;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeStyle(styleText) {
  return styleText
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const separatorIndex = item.indexOf(":");
      if (separatorIndex === -1) {
        return "";
      }

      const property = item.slice(0, separatorIndex).trim().toLowerCase();
      const value = item.slice(separatorIndex + 1).trim();
      if (!ALLOWED_STYLES.has(property)) {
        return "";
      }
      if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) {
        return "";
      }
      return `${property}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeNode(node, documentRef) {
  if (node.nodeType === window.Node.TEXT_NODE) {
    return documentRef.createTextNode(node.textContent || "");
  }

  if (node.nodeType !== window.Node.ELEMENT_NODE) {
    return null;
  }

  const tagName = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = documentRef.createDocumentFragment();
    Array.from(node.childNodes).forEach(child => {
      const sanitizedChild = sanitizeNode(child, documentRef);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const sanitizedElement = documentRef.createElement(tagName);

  Array.from(node.attributes).forEach(attribute => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith("on")) {
      return;
    }

    if (name === "style") {
      const safeStyle = sanitizeStyle(value);
      if (safeStyle) {
        sanitizedElement.setAttribute("style", safeStyle);
      }
      return;
    }

    if (tagName === "a" && name === "href") {
      if (SAFE_URL_PATTERN.test(value)) {
        sanitizedElement.setAttribute("href", value);
        if (!value.startsWith("#")) {
          sanitizedElement.setAttribute("target", "_blank");
          sanitizedElement.setAttribute("rel", "noopener noreferrer");
        }
      }
      return;
    }

    if (name === "id") {
      sanitizedElement.setAttribute("id", value);
      return;
    }

    if (name === "class") {
      return;
    }
  });

  Array.from(node.childNodes).forEach(child => {
    const sanitizedChild = sanitizeNode(child, documentRef);
    if (sanitizedChild) {
      sanitizedElement.appendChild(sanitizedChild);
    }
  });

  return sanitizedElement;
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false
});

function looksLikeMarkdown(value) {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|(\*\*|__|~~|`)|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\[\^[^\]]+\]|(^|\s)(https?:\/\/|mailto:|tel:)/i.test(value);
}

function transformFootnotes(value) {
  const footnotes = [];
  const body = value.replace(FOOTNOTE_DEFINITION_PATTERN, (match, id, content) => {
    footnotes.push({ id, content: content.trim() });
    return "";
  });

  const normalizedBody = body.replace(FOOTNOTE_REFERENCE_PATTERN, (match, id) => {
    return `<sup>[${id}]</sup>`;
  }).trim();

  if (!footnotes.length) {
    return normalizedBody;
  }

  const footnoteBlock = [
    normalizedBody,
    "",
    "---",
    "",
    footnotes.map(item => `- [${item.id}] ${item.content}`).join("\n")
  ].filter(Boolean).join("\n");

  return footnoteBlock;
}

function trimTrailingPunctuation(url) {
  let cleanUrl = url;
  let trailing = "";

  while (/[)\]）】。，、；：！？，.]$/.test(cleanUrl)) {
    trailing = cleanUrl.slice(-1) + trailing;
    cleanUrl = cleanUrl.slice(0, -1);
  }

  return {
    url: cleanUrl,
    trailing
  };
}

function renderMarkdown(value) {
  const normalizedValue = transformFootnotes(value).replace(PLAIN_URL_PATTERN, (match, prefix, url) => {
    const normalizedUrl = trimTrailingPunctuation(url);
    if (prefix) {
      return `${prefix}<${normalizedUrl.url}>${normalizedUrl.trailing}`;
    }
    return `<${normalizedUrl.url}>${normalizedUrl.trailing}`;
  }).replace(MARKDOWN_LINK_PATTERN, (match, text, url) => `[${text}](${url})`);

  return marked.parse(normalizedValue);
}

export function sanitizeRichText(value) {
  const rawValue = typeof value === "string" ? value : "";
  if (!rawValue) {
    return "";
  }

  const sourceHtml = looksLikeHtml(rawValue)
    ? rawValue
    : (looksLikeMarkdown(rawValue) ? renderMarkdown(rawValue) : escapeHtml(rawValue).replace(/\n/g, "<br>"));

  const parser = new window.DOMParser();
  const parsed = parser.parseFromString(sourceHtml, "text/html");
  const container = document.createElement("div");

  Array.from(parsed.body.childNodes).forEach(node => {
    const sanitizedNode = sanitizeNode(node, document);
    if (sanitizedNode) {
      container.appendChild(sanitizedNode);
    }
  });

  return container.innerHTML;
}

export function renderRichTextForDebug(value) {
  const rawValue = typeof value === "string" ? value : "";
  if (!rawValue) {
    return "";
  }

  return sanitizeRichText(rawValue);
}
