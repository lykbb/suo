#!/usr/bin/env python3
"""Render an eight-section report and workbook using only the standard library."""

import argparse
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


TITLES = (
    "一页纸结论", "问题在哪", "要做成什么样", "取舍原则",
    "具体做什么", "版本节奏", "决策待办", "附录 · 详细资料",
)
LABELS = ("核心结论", "问题诊断", "目标状态", "取舍原则", "需求拆解", "落地规划", "待办与缺口", "附录")
TEMPLATE = Path(__file__).resolve().parents[1] / "assets" / "report-template.html"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def field(obj, key, default=None):
    require(isinstance(obj, dict), "字段所属节点必须是对象")
    value = obj.get(key, default)
    require(isinstance(value, str), f"{key} 必须是字符串")
    return value


def text(value):
    return html.escape(str(value), quote=True)


def rich(value):
    """Escape text before adding a limited set of inline formatting."""
    require(isinstance(value, str), "正文必须是字符串")

    def plain(part):
        escaped = text(part)
        return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped).replace("\n", "<br>")

    result, cursor = [], 0
    for match in re.finditer(r"\[([^\]\n]+)\]\(([^\s)]+)\)", value):
        result.append(plain(value[cursor:match.start()]))
        label, url = match.groups()
        parsed = urlsplit(url)
        valid = ((parsed.scheme in ("http", "https") and bool(parsed.netloc))
                 or re.fullmatch(r"#[A-Za-z][A-Za-z0-9_-]*", url) is not None)
        if valid:
            result.append(f'<a href="{text(url)}" rel="noopener noreferrer">{plain(label)}</a>')
        else:
            result.append(plain(match.group(0)))
        cursor = match.end()
    result.append(plain(value[cursor:]))
    return "".join(result)


def subheading(block):
    title = field(block, "title", "")
    return f'<h3 class="sub-title">{rich(title)}</h3>' if title else ""


def rows_array(obj, key):
    rows = obj.get(key)
    require(isinstance(rows, list) and rows, f"{key} 必须是非空数组")
    return rows


def table(columns, rows, class_name=""):
    require(isinstance(columns, list) and columns and all(isinstance(c, str) for c in columns), "表格列名必须是非空字符串数组")
    require(isinstance(rows, list) and rows, "表格需要至少一行数据")
    classes = f' class="{text(class_name)}"' if class_name else ""
    out = [f'<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的表格"><table{classes}><thead><tr>']
    out.extend(f'<th scope="col">{rich(c)}</th>' for c in columns)
    out.append('</tr></thead><tbody>')
    for row in rows:
        require(isinstance(row, list) and len(row) == len(columns), "表格行的单元格数与列数不一致")
        cells = []
        for index, value in enumerate(row):
            label = columns[index]
            classes = []
            if label == "编号":
                classes.append("cell-id")
            elif label in ("证据", "优先级", "建议级别", "状态", "阶段"):
                classes.append("cell-center")
                if isinstance(value, str) and len(value.strip()) <= 16 and "\n" not in value:
                    classes.append("cell-compact")
            elif class_name == "req-tbl" and index == 2:
                classes.append("cell-center")
            cell_class = f' class="{" ".join(classes)}"' if classes else ""
            cells.append(f'<td{cell_class}>{rich(value)}</td>')
        out.append('<tr>' + ''.join(cells) + '</tr>')
    out.append('</tbody></table></div>')
    return ''.join(out)


def render_blocks(blocks, seen_ids, depth=0):
    require(depth <= 8, "折叠面板嵌套过深")
    require(isinstance(blocks, list) and blocks, "章节或面板需要非空 blocks")
    output = []
    for block in blocks:
        require(isinstance(block, dict), "组件必须是对象")
        kind = field(block, "type")
        heading = subheading(block) if kind not in ("details",) else ""
        if kind == "text":
            body = f'<p class="report-text">{rich(field(block, "text"))}</p>'
        elif kind == "callout":
            body = f'<div class="callout"><div class="callout-label">{rich(field(block, "label"))}</div><div class="callout-text">{rich(field(block, "text"))}</div></div>'
        elif kind == "cards":
            cards = []
            for item in rows_array(block, "items"):
                cards.append('<article class="card"><span class="pri-badge pri-risk">' + rich(field(item, "badge")) + '</span><h3 class="card-title">' + rich(field(item, "title")) + '</h3><div class="card-body">' + rich(field(item, "text")) + '</div></article>')
            body = '<div class="grid-3">' + ''.join(cards) + '</div>'
        elif kind == "themes":
            items = []
            for i, item in enumerate(rows_array(block, "items")):
                priority = field(item, "priority")
                rank = re.search(r"(?<![A-Za-z0-9])P[012](?![A-Za-z0-9])", priority, re.I)
                priority_class = f" pri-{rank.group().lower()}" if rank else ""
                items.append(f'<article class="thm thm-{i % 3 + 1}"><div class="thm-k">{rich(field(item, "label"))}</div><div><h3 class="thm-t">{rich(field(item, "title"))}<span class="thm-p{priority_class}">{rich(priority)}</span></h3><div class="thm-d">{rich(field(item, "text"))}</div><div class="thm-o">主要承接：{rich(field(item, "owner"))}</div></div></article>')
            body = '<div class="rb">' + ''.join(items) + '</div>'
        elif kind == "table":
            body = table(block.get("columns"), block.get("rows"))
        elif kind == "journey":
            items = ['<div class="jn-head"><div>用户所处步骤</div><div class="h-now">今天的样子</div><div class="h-tgt">目标体验</div><div class="h-mx">怎么衡量</div></div>']
            for i, row in enumerate(rows_array(block, "rows")):
                items.append(f'<div class="jn-row"><div class="jn-step"><span class="jn-num">{i + 1}</span><div class="jn-name">{rich(field(row, "step"))}</div></div><div class="jn-now">{rich(field(row, "now"))}</div><div class="jn-tgt">{rich(field(row, "target"))}</div><div class="jn-mx">{rich(field(row, "metric"))}</div></div>')
            body = '<div class="journey-scroll"><div class="jn">' + ''.join(items) + '</div></div>'
        elif kind == "principles":
            items = []
            for i, item in enumerate(rows_array(block, "items")):
                items.append(f'<article class="pr-item"><div class="pr-n">{i + 1:02}</div><div><h3 class="pr-h">{rich(field(item, "title"))}</h3><div class="pr-b">{rich(field(item, "reason"))}<br><b>怎么判断：</b>{rich(field(item, "rule"))}</div></div></article>')
            body = '<div class="pr-list">' + ''.join(items) + '</div>'
        elif kind == "requirements":
            items = []
            for i, theme in enumerate(rows_array(block, "themes")):
                items.append(f'<div class="thm-head thm-h{i % 3 + 1}"><div class="thm-hk">{rich(field(theme, "label"))}</div><div><h3 class="thm-ht">{rich(field(theme, "title"))}</h3><div class="thm-hd">{rich(field(theme, "description"))}</div></div></div>')
                for task in rows_array(theme, "tasks"):
                    items.append(f'<h3 class="sub-title">任务 {rich(field(task, "id"))} · {rich(field(task, "title"))}</h3><p class="report-text">{rich(field(task, "goal"))}</p>')
                    req_rows = []
                    for row in rows_array(task, "rows"):
                        rid = field(row, "id")
                        require(bool(rid.strip()) and rid not in seen_ids, f"需求编号重复或为空：{rid}")
                        seen_ids.add(rid)
                        name = field(row, "name")
                        desc = field(row, "description")
                        prerequisite = field(row, "prerequisite")
                        status = field(row, "status")
                        req_rows.append([rid, f'**{name}**\n{desc}\n前置条件：{prerequisite}\n状态：{status}', field(row, "owners"), field(row, "load"), field(row, "value")])
                    items.append(table(["编号", "需求", "承接团队／角色", "工作负载", "带来什么"], req_rows, class_name="req-tbl"))
            body = ''.join(items)
        elif kind == "roadmap":
            lanes = rows_array(block, "lanes")
            require(all(isinstance(lane, str) for lane in lanes), "版本矩阵 lanes 必须是字符串")
            columns = f'160px repeat({len(lanes)}, minmax(200px, 1fr))'
            items = ['<div class="rm-head">版本／阶段</div>']
            items.extend(f'<div class="rm-head">{rich(lane)}</div>' for lane in lanes)
            for row in rows_array(block, "rows"):
                cells = row.get("cells")
                require(isinstance(cells, list) and len(cells) == len(lanes), "版本矩阵单元格数与专题数不一致")
                items.append(f'<div class="rm-ver"><div class="rm-ver-name">{rich(field(row, "phase"))}</div><div class="rm-ver-date">{rich(field(row, "dates"))}</div></div>')
                for i, cell in enumerate(cells):
                    items.append(f'<div class="rm-cell lane-{i % 3 + 1}">{rich(cell)}</div>')
            body = f'<div class="table-scroll"><div class="rm-grid" style="grid-template-columns:{columns}">' + ''.join(items) + '</div></div>'
            note = field(block, "note", "")
            if note:
                body += f'<p class="note">{rich(note)}</p>'
        elif kind == "details":
            body = f'<details class="apx"><summary>{rich(field(block, "title"))}</summary><div class="apx-body">{render_blocks(block.get("blocks"), seen_ids, depth + 1)}</div></details>'
        elif kind == "funnel":
            items = []
            for row in rows_array(block, "rows"):
                percent = row.get("percent")
                require(type(percent) in (int, float) and 0 <= percent <= 100, "漏斗 percent 必须是 0–100 的有限数字")
                items.append(f'<div class="funnel-step"><div class="funnel-label">{rich(field(row, "name"))}</div><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:{percent}%;background:var(--blue)">{rich(field(row, "value"))}</div></div></div>')
                note = field(row, "note", "")
                if note:
                    items.append(f'<p class="funnel-drop">{rich(note)}</p>')
            body = '<div class="funnel">' + ''.join(items) + '</div>'
        else:
            raise ValueError(f"未知组件：{kind}")
        output.append(heading + body)
    return '\n'.join(output)


def build(payload):
    require(isinstance(payload, dict), "输入根节点必须是对象")
    meta = payload.get("meta")
    require(isinstance(meta, dict), "缺少 meta")
    for key in ("project", "title", "subtitle", "owner", "date", "status", "mode"):
        require(bool(field(meta, key).strip()), f"meta.{key} 不能为空")
    workbook = field(payload, "workbook")
    require(bool(workbook.strip()), "工作底稿不能为空")
    sections = payload.get("sections")
    require(isinstance(sections, list) and len(sections) == 8, "必须提供八个章节")
    require([s.get("id") for s in sections if isinstance(s, dict)] == [f"s{i}" for i in range(8)], "章节必须依次为 s0–s7")
    seen_ids, section_html = set(), []
    for i, section in enumerate(sections):
        intro = field(section, "intro", "")
        section_html.append(f'<section id="s{i}" aria-labelledby="title-s{i}"><div class="section-header"><div class="section-label blue">{LABELS[i]}</div><h2 class="section-title" id="title-s{i}">{TITLES[i]}</h2><p class="section-desc">{rich(intro)}</p></div>{render_blocks(section.get("blocks"), seen_ids)}</section>')
    nav = ''.join(f'<a class="nav-item{" active" if i == 0 else ""}" href="#s{i}"><span class="nav-num">{i:02}</span>{title}</a>' for i, title in enumerate(TITLES))
    replacements = {
        "__TITLE__": text(meta["title"]), "__PROJECT__": text(meta["project"]),
        "__MODE__": text(meta["mode"]), "__STATUS__": text(meta["status"]),
        "__OWNER__": text(meta["owner"]), "__DATE__": text(meta["date"]),
        "__SUBTITLE__": rich(meta["subtitle"]), "__NAV__": nav,
        "__SECTIONS__": '\n'.join(section_html),
    }
    template = TEMPLATE.read_text(encoding="utf-8")
    require(all(key in template for key in replacements), "模板缺少必要插槽")
    rendered = re.sub(r"__[A-Z]+__", lambda match: replacements.get(match.group(0), match.group(0)), template)
    return rendered, workbook.rstrip() + '\n'


def demo_payload():
    """A method and layout preview without a concrete business case."""
    sections = [
        {"id": "s0", "intro": "如果只看一页，看这一页。以下展示通用组织方式，具体判断须由当次项目证据推导。", "blocks": [
            {"type": "callout", "label": "一句话逻辑", "text": "先确认**要改善的业务结果**，再用证据找出用户任务中的关键障碍。根据目标体验和真实约束形成解决主线，拆成任务与需求，最后安排可验证的版本。**一页纸结论在分析完成后提炼。**"},
            {"type": "cards", "items": [
                {"badge": "问题与证据", "title": "用户具体卡在哪里", "text": "记录实际场景、行为和代价。每条核心问题附证据、口径及缺口，不用方案名替代问题。"},
                {"badge": "成因判断", "title": "为什么认为是这个原因", "text": "区分已观察到的现象、待验证的成因和其他解释。相关性及小样本偏好不能直接证明因果。"},
                {"badge": "解决主线", "title": "为什么沿这些方向推进", "text": "主线逐一回应问题，并落到完整目标体验。数量、优先级和承接角色来自本次项目分析。"}]},
            {"type": "themes", "title": "问题如何承接为专题", "items": [
                {"label": "主线推导", "title": "从障碍到可观察的改善", "priority": "按证据排序", "text": "一个专题回应一类核心问题；专题下拆任务，再拆用户可感知的具体需求。", "owner": "根据实际工作确认"},
                {"label": "落地条件", "title": "分清前置任务与交付依赖", "priority": "按依赖安排", "text": "标尺、数据、接口及人工兜底各有作用。把影响后续能力成立的前置条件明确写出来。", "owner": "相关团队共同确认"}]}]},
        {"id": "s1", "intro": "从业务目标定位障碍，用证据支持判断，再提出需要验证的成因。", "blocks": [
            {"type": "table", "columns": ["分析层次", "应该得到什么", "证据不足时"], "rows": [
                ["实际问题", "谁在何种场景、哪一步受阻，当前怎样解决", "问近期行为，组织访谈或观察"],
                ["规模与代价", "数据定义、频度、影响范围或实际损失", "取数或建立基线，保留未知状态"],
                ["成因判断", "支持依据、其他解释、待验证假设", "设计能区分解释的验证"],
                ["竞品对照", "与本次决定相关的流程或结果差距", "核对来源与版本，不推定内部实现"]]}]},
        {"id": "s2", "intro": "按一次完整任务，逐步对照今天的样子、目标体验和衡量方式。", "blocks": [
            {"type": "journey", "rows": [
                {"step": "开始任务", "now": "记录用户当前的入口和替代方式", "target": "描述用户能如何进入并开始任务", "metric": "入口与任务开始指标\n基线来自实际取数或观察"},
                {"step": "取得结果", "now": "记录处理过程与具体障碍", "target": "描述合格结果，以及正常、异常和核查路径", "metric": "效果与任务完成标准\n建议门槛需确认"},
                {"step": "实际使用", "now": "记录结果之后还要做的工作", "target": "描述怎样将结果用于后续工作并完成价值闭环", "metric": "结果使用及业务结果指标\n关联关系需要验证"}]}]},
        {"id": "s3", "intro": "每条原则都应来自当前目标、证据、依赖或资源，能判断具体需求的去留。", "blocks": [
            {"type": "principles", "items": [
                {"title": "用实际价值和证据判断", "reason": "先区分用户问题与解决方案，再比较候选方式。", "rule": "说清需求解决哪个障碍、对完整任务有什么作用、有什么支持依据。"},
                {"title": "把前置条件与瓶颈纳入排序", "reason": "依赖和受限资源决定哪些任务能先开展。", "rule": "检查标准、数据、接口和容量；未经估算的计划保留条件。"}]}]},
        {"id": "s4", "intro": "通过专题、任务和需求的层级，把问题推导成团队可评审的工作。此处展示字段标准。", "blocks": [
            {"type": "requirements", "themes": [{"label": "专题结构", "title": "回应一个已确认的核心问题", "description": "说明专题目标、对应问题、目标体验位置以及主要承接角色。", "tasks": [{"id": "T1", "title": "实现一个可观察改善", "goal": "说明这项任务如何支撑专题，列出必要的前置条件。", "rows": [
                {"id": "R1", "name": "具体需求的字段标准", "description": "写清用户动作、能力或规则，关联问题、证据和旅程步骤。", "owners": "按实际工作确认", "load": "待团队估算", "value": "对应任务的可观察价值或指标", "prerequisite": "按场景检查数据、标准、接口及授权", "status": "结构示例，非项目需求"}]}]}]}]},
        {"id": "s5", "intro": "以版本或阶段为行、解决专题为列，展示交付、前置条件和继续条件。", "blocks": [
            {"type": "roadmap", "lanes": ["问题与方向", "能力与交付"], "rows": [
                {"phase": "验证阶段", "dates": "由项目实际日历决定", "cells": ["确认核心问题、目标体验与取舍依据", "补齐关键证据、效果标尺和团队估算"]},
                {"phase": "首期交付", "dates": "容量确认后形成安排", "cells": ["验证最小但完整的用户任务闭环", "完成必要需求、联调、异常兜底与评测"]}], "note": "这是矩阵结构示例，不规定每个项目的阶段数量、建设顺序或工期。"}]},
        {"id": "s6", "intro": "将未闭环事项转为具体决策和验证任务，而不是泛化风险清单。", "blocks": [
            {"type": "table", "columns": ["待办类型", "要确认什么", "谁来确认", "时间／触发条件"], "rows": [
                ["关键选择", "哪项选择会改变方向、范围或投入", "用户或相应决策者", "进入相关阶段前"],
                ["证据缺口", "哪条假设需要取数、访谈或试验", "相关调研或数据角色", "作出受影响的决定前"],
                ["容量与依赖", "谁交付什么，估算与前置条件是否成立", "相关承接团队", "形成可承诺版本前"]]}]},
        {"id": "s7", "intro": "将详细支撑折叠保存，正文结论应能回到这些依据。", "blocks": [
            {"type": "details", "title": "证据索引需要记录什么", "blocks": [{"type": "table", "columns": ["字段", "要求"], "rows": [["来源与时间", "保留可访问的来源、提供者及采集或核对时间"], ["口径与状态", "区分用户提供、实测、公开资料、推算、假设和未知"], ["支持判断", "说明证据支持什么，以及不能证明什么"]]}]},
            {"type": "details", "title": "AI 分析的额外检查", "blocks": [{"type": "text", "text": "比较 AI 与非 AI 方案；明确数据来源与使用条件、效果标准、单次或阶段成本，以及 AI／规则／人工的分工和失败兜底。具体结论放回相关问题、目标体验、需求与依赖中。"}]}]},
    ]
    return {"meta": {"project": "产品立项与规划", "title": "产品立项与规划 · 通用结构预览", "subtitle": "从证据到判断，从判断到需求与版本。用于核对内容逻辑、颗粒度和 UI。", "owner": "使用时由项目确认", "date": "通用模板", "status": "结构预览", "mode": "新产品／已有产品改进"}, "sections": sections, "workbook": "# 工作底稿示例\n\n本文件展示底稿结构，不包含真实业务案例、调研结论或已批准的立项决定。\n\n## 项目约定\n\n记录项目类型、决策对象、业务目标、资料范围、报告成熟度和交付位置。\n\n## 已确认选择\n\n记录用户或相关决策者已确认的方向、用户范围、问题、目标体验、取舍与首期范围。确认假设不等于验证事实。\n\n## 证据索引\n\n每条证据记录来源、时间、口径、状态、支持的判断与不能证明的内容。\n\n## 假设与替代解释\n\n记录成因假设、支持依据、其他解释以及能区分它们的验证方法。\n\n## 未决项与验证任务\n\n记录具体问题、影响哪个决定、方法与样本、通过标准、确认方以及时间或触发条件。\n\n## 当前阶段\n\n记录已完成的推导、当前阻塞点以及进入下一阶段的条件。\n"}


def main():
    parser = argparse.ArgumentParser(description="生成八章 HTML 报告和 Markdown 工作底稿")
    parser.add_argument("--input", default="-", help="JSON 路径；默认从标准输入读取")
    parser.add_argument("--demo", action="store_true", help="生成无业务案例的结构预览")
    parser.add_argument("--html", required=True, help="新 HTML 文件的绝对路径")
    parser.add_argument("--workbook", required=True, help="新工作底稿的绝对路径")
    args = parser.parse_args()
    try:
        outputs = [Path(args.html).expanduser(), Path(args.workbook).expanduser()]
        require(all(p.is_absolute() for p in outputs), "输出路径必须是绝对路径")
        require(outputs[0].resolve() != outputs[1].resolve(), "两份输出必须使用不同路径")
        for path in outputs:
            require(not path.exists() and not path.is_symlink(), f"拒绝覆盖已有路径：{path}")
        if args.demo:
            require(args.input == "-", "--demo 与 --input 不能同时使用")
            payload = demo_payload()
        elif args.input == "-":
            payload = json.load(sys.stdin)
        else:
            payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        rendered, workbook = build(payload)
        for path, content in zip(outputs, (rendered, workbook)):
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as handle:
                handle.write(content)
        print(json.dumps({"html": str(outputs[0]), "workbook": str(outputs[1])}, ensure_ascii=False))
    except (ValueError, OSError, TypeError, json.JSONDecodeError) as error:
        print(f"生成失败：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
