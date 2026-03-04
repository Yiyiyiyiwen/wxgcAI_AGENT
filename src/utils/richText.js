const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
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
        sanitizedElement.setAttribute("target", "_blank");
        sanitizedElement.setAttribute("rel", "noopener noreferrer");
      }
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

export function sanitizeRichText(value) {
  const rawValue = typeof value === "string" ? value : "";
  if (!rawValue) {
    return "";
  }

  if (!looksLikeHtml(rawValue)) {
    return escapeHtml(rawValue).replace(/\n/g, "<br>");
  }

  const parser = new window.DOMParser();
  const parsed = parser.parseFromString(rawValue, "text/html");
  const container = document.createElement("div");

  Array.from(parsed.body.childNodes).forEach(node => {
    const sanitizedNode = sanitizeNode(node, document);
    if (sanitizedNode) {
      container.appendChild(sanitizedNode);
    }
  });

  return container.innerHTML;
}
