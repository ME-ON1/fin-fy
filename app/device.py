"""User-Agent -> phone model detection.

Android UAs carry the model token between the Android version and " Build/".
iPhone UAs only say "iPhone". Samsung device codes are mapped to marketing names
for the common ones; unknown codes are shown as-is.
"""

import re

_ANDROID_RE = re.compile(r"Android [\d.]+; (.+?)\s+Build/")
_IPHONE_RE = re.compile(r"iPhone OS \d+")

# Common Samsung model codes -> marketing name (add more as they show up).
_SAMSUNG = {
    "SM-G991B": "Galaxy S21",
    "SM-G996B": "Galaxy S21+",
    "SM-S911B": "Galaxy S23",
    "SM-S916B": "Galaxy S23+",
    "SM-S921B": "Galaxy S24",
    "SM-S926B": "Galaxy S24+",
    "SM-A525F": "Galaxy A52",
    "SM-A545F": "Galaxy A54",
    "SM-A555F": "Galaxy A55",
    "SM-M515F": "Galaxy M51",
    "SM-M315F": "Galaxy M31",
}


def detect_phone_model(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    ua = user_agent
    if "iPhone" in ua and _IPHONE_RE.search(ua):
        return "iPhone"
    if "iPad" in ua:
        return "iPad"
    m = _ANDROID_RE.search(ua)
    if m:
        code = m.group(1).strip()
        return _SAMSUNG.get(code, code)
    if "Android" in ua:
        m2 = re.search(r"Android [\d.]+; ([^;)]+)", ua)
        if m2:
            return m2.group(1).strip().split("/")[0].strip()
    return None
