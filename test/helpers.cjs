const path = require('node:path');
const root = path.resolve(__dirname, '..');
function stub(relative, exports) {
  const id = require.resolve(path.join(root, relative));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(f => matches(row, f));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([op, v]) => {
        if (op === '$gte') return row[key] >= v;
        if (op === '$lte') return row[key] <= v;
        if (op === '$lt') return row[key] < v;
        if (op === '$ne') return row[key] !== v;
        if (op === '$nin') return !v.includes(row[key]);
        if (op === '$in') return v.includes(row[key]);
        if (op === '$exists') return (row[key] !== undefined) === v;
        throw new Error(`Unsupported test query operator: ${op}`);
      });
    }
    return row[key] === value;
  });
}
function query(rows, filter = {}, one = false) {
  let selected = rows.filter(row => matches(row, filter));
  const chain = {
    sort(order) { selected.sort((a, b) => {
      for (const [key, dir] of Object.entries(order)) {
        if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * dir;
      }
      return 0;
    }); return chain; },
    limit(n) { selected = selected.slice(0, n); return chain; },
    select() { return chain; },
    find(extra) { selected = selected.filter(row => matches(row, extra)); return chain; },
    lean() { return Promise.resolve(one ? selected[0] || null : selected); },
    then(resolve, reject) { return chain.lean().then(resolve, reject); },
  };
  return chain;
}
function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    send(data) { this.data = data; return this; }, render(view, data) { this.view = view; this.data = data; return this; },
    redirect(url) { this.statusCode = 302; this.location = url; return this; },
    setHeader(key, value) { this.headers[key] = value; } };
}
module.exports = { stub, matches, query, response };
