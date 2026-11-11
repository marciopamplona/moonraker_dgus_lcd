# Discover the parameters of a Klipper [gcode_macro] from its G-Code
# template (the same approach Mainsail/Fluidd use) and build the command.
#
# This file may be distributed under the terms of the GNU GPLv3 license.
import re

# params.NAME / params["NAME"] / params['NAME'], optionally followed by
# filters such as |default(1.5)|float
_PARAM_RE = re.compile(
    r"params\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)"
    r"|\[\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s*\])"
    r"((?:\s*\|\s*[a-z_]+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*)")
_FILTER_RE = re.compile(r"\|\s*([a-z_]+)(?:\s*\(((?:[^()]|\([^()]*\))*)\))?")
_NUM_RE = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def _literal(text):
    """-> (value, type) of a default(...) argument, or (None, None) when it
    is an expression we can't evaluate (e.g. a printer variable)."""
    arg = text.split(",")[0].strip()
    if _NUM_RE.match(arg):
        return arg, ("float" if re.search(r"[.eE]", arg) else "int")
    if len(arg) >= 2 and arg[0] == arg[-1] and arg[0] in "'\"":
        return arg[1:-1], "str"
    if arg in ("True", "False", "true", "false"):
        return ("1" if arg.lower() == "true" else "0"), "int"
    return None, None


def parse_params(gcode):
    """List of {"name", "default", "type"} in order of first use.

    type is "int", "float", "str" or "num" (unknown, treated as a number).
    default is a string, or None when the macro computes it itself.
    """
    found = {}
    for m in _PARAM_RE.finditer(gcode or ""):
        name = (m.group(1) or m.group(2)).upper()
        info = found.setdefault(name, {"name": name, "default": None,
                                       "type": "num"})
        for fm in _FILTER_RE.finditer(m.group(3) or ""):
            filt, arg = fm.group(1), fm.group(2)
            if filt == "default" and arg is not None:
                value, vtype = _literal(arg)
                if value is not None and info["default"] is None:
                    info["default"] = value
                    if info["type"] == "num":
                        info["type"] = vtype
            elif filt in ("int", "float"):
                info["type"] = filt
            elif filt in ("string", "lower", "upper") and \
                    info["type"] == "num":
                info["type"] = "str"
    return list(found.values())


def macro_params(settings, name):
    """Parameters of macro `name` from configfile.settings."""
    section = settings.get("gcode_macro " + name.lower(), {})
    return parse_params(section.get("gcode", ""))


def format_value(value, ptype="num"):
    """Number -> text as it should appear on the G-Code line."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if ptype == "int":
        return str(int(round(value)))
    text = ("%.2f" % value).rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def build_command(name, params, values):
    """`NAME K=V ...` with only the values the user entered."""
    parts = [name]
    for p in params:
        if p["name"] in values:
            parts.append("%s=%s" % (p["name"],
                                    format_value(values[p["name"]],
                                                 p["type"])))
    return " ".join(parts)
