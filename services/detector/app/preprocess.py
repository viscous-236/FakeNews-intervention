import re
import unicodedata

_URL_RE = re.compile(r"https?://\S+")
_USER_RE = re.compile(r"@\w+")
_WHITESPACE_RE = re.compile(r"\s+")


def preprocess_text(text: str) -> str:
    """Normalize and clean text for fake-news detection (training and serving).

    Rules:
    1. Unicode NFKC normalization.
    2. Replace URLs (https?://\\S+) with '<url>'.
    3. Replace user mentions (@\\w+) with '<user>'.
    4. Collapse whitespace sequences to single space.
    5. Strip leading and trailing whitespace.

    Note: Lowercasing is NOT performed here; it is handled by the
    vectorizer (baseline) or tokenizer (transformer).
    """
    if not text:
        return ""

    # 1. Unicode NFKC normalization
    normalized = unicodedata.normalize("NFKC", text)

    # 2. URL replacement
    without_urls = _URL_RE.sub("<url>", normalized)

    # 3. User mention replacement
    without_users = _USER_RE.sub("<user>", without_urls)

    # 4. Collapse whitespace
    collapsed = _WHITESPACE_RE.sub(" ", without_users)

    # 5. Strip leading/trailing whitespace
    return collapsed.strip()
