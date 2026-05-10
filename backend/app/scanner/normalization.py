from urllib.parse import urlsplit, urlunsplit


def normalize_scan_url(url: str) -> str:
    value = str(url).strip()
    if not value:
        return value

    parsed = urlsplit(value)
    path = parsed.path
    if path == "/" and not parsed.query and not parsed.fragment:
        path = ""

    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            parsed.query,
            parsed.fragment,
        )
    )
