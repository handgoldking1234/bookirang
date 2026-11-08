/* 북이랑 프로토타입 미니 런타임: {{값}}, sc-if, sc-for, on이벤트만 처리 */
class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(next) { Object.assign(this.state, next); render(); }
}
var __comp = null;
var HOLE = /\{\{\s*([\w.$]+)\s*\}\}/g;
var WHOLE = /^\s*\{\{\s*([\w.$]+)\s*\}\}\s*$/;
function look(scope, path) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, scope);
}
function fill(str, scope) {
  return str.replace(HOLE, function (_, p) { var v = look(scope, p); return v == null ? '' : v; });
}
function walk(node, scope) {
  if (node.nodeType === 3) { if (node.nodeValue.indexOf('{{') > -1) node.nodeValue = fill(node.nodeValue, scope); return; }
  if (node.nodeType !== 1) return;
  var tag = node.tagName.toLowerCase();
  if (tag === 'sc-if') {
    var m = (node.getAttribute('value') || '').match(WHOLE);
    var ok = m ? look(scope, m[1]) : false;
    var frag = document.createDocumentFragment();
    if (ok) { while (node.firstChild) frag.appendChild(node.firstChild); kids(frag, scope); }
    node.replaceWith(frag);
    return;
  }
  if (tag === 'sc-for') {
    var lm = (node.getAttribute('list') || '').match(WHOLE);
    var list = (lm && look(scope, lm[1])) || [];
    var as = node.getAttribute('as') || 'item';
    var out = document.createDocumentFragment();
    list.forEach(function (item, i) {
      var s = Object.create(scope); s[as] = item; s.$index = i;
      var f = document.createDocumentFragment();
      Array.prototype.forEach.call(node.childNodes, function (c) { f.appendChild(c.cloneNode(true)); });
      kids(f, s);
      out.appendChild(f);
    });
    node.replaceWith(out);
    return;
  }
  Array.prototype.slice.call(node.attributes).forEach(function (a) {
    if (a.name.indexOf('hint-') === 0) { node.removeAttribute(a.name); return; }
    var w = a.value.match(WHOLE);
    if (a.name.indexOf('on') === 0 && w) {
      var fn = look(scope, w[1]);
      node.removeAttribute(a.name);
      if (typeof fn === 'function') node.addEventListener(a.name.slice(2), fn);
      return;
    }
    if (a.value.indexOf('{{') > -1) node.setAttribute(a.name, fill(a.value, scope));
  });
  kids(node, scope);
}
function kids(parent, scope) {
  Array.prototype.slice.call(parent.childNodes).forEach(function (c) { walk(c, scope); });
}
function render() {
  var app = document.getElementById('app');
  var keep = {};
  app.querySelectorAll('.scroll').forEach(function (el, i) { keep[i] = el.scrollTop; });
  var vals = __comp.renderVals();
  var frag = document.getElementById('tpl').content.cloneNode(true);
  kids(frag, vals);
  app.replaceChildren(frag);
  app.querySelectorAll('.scroll').forEach(function (el, i) { if (keep[i]) el.scrollTop = keep[i]; });
  if (__comp.afterRender) __comp.afterRender();
}
function mount(C) { __comp = new C({}); render(); }
