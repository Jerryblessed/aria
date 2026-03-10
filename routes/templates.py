from flask import Blueprint, request, jsonify
from data.templates import TEMPLATES, TEMPLATE_MAP

templates_bp = Blueprint("templates", __name__, url_prefix="/api/templates")


@templates_bp.get("")
def api_templates():
    interests = [i.strip() for i in request.args.get("interests", "").split(",") if i.strip()]
    out = []
    for t in TEMPLATES:
        e = dict(t)
        e["_score"] = sum(1 for i in t.get("interests", []) if i in interests) if interests else 0
        out.append(e)
    out.sort(key=lambda x: -x.pop("_score"))
    return jsonify({"templates": out})


@templates_bp.get("/<tid>")
def api_template(tid):
    t = TEMPLATE_MAP.get(tid)
    if not t:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"template": t})
