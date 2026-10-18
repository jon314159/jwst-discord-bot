export class StateError extends Error {}
export class D1State {
  constructor(db) { this.db = db; }
  async claim(day, channel) {
    await this.db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES ('channel',?)").bind(channel).run();
    const pinned = await this.db.prepare("SELECT value FROM meta WHERE key='channel'").first();
    if (pinned.value !== channel) throw new StateError('Database belongs to another channel; use a separate database');
    if (await this.db.prepare("SELECT day FROM deliveries WHERE status IN ('pending','uncertain') LIMIT 1").first()) throw new StateError('Unresolved delivery: inspect channel and reconcile database before resuming');
    const r = await this.db.prepare(`INSERT OR IGNORE INTO deliveries(day,channel,status)
      SELECT ?,?,'selecting' WHERE NOT EXISTS (SELECT 1 FROM deliveries WHERE status IN ('pending','uncertain'))`).bind(day,channel).run();
    return r.meta.changes === 1;
  }
  async used() {
    const {results} = await this.db.prepare("SELECT family,image_url FROM deliveries WHERE status IN ('sent','pending','uncertain')").all();
    const rejected = await this.db.prepare("SELECT image_id FROM rejected_images WHERE updated > datetime('now','-30 days')").all();
    return {families:new Set(results.map(x=>x.family)),urls:new Set(results.map(x=>x.image_url)),rejected:new Set(rejected.results.map(x=>x.image_id))};
  }
  async reject(id, reason) {
    await this.db.prepare("INSERT INTO rejected_images(image_id,reason) VALUES (?,?) ON CONFLICT(image_id) DO UPDATE SET reason=excluded.reason,updated=datetime('now')").bind(id,reason).run();
  }
  async reserve(day, image, nonce) {
    const r = await this.db.prepare(`UPDATE deliveries SET status='pending',image_id=?,family=?,image_url=?,image_json=?,nonce=?,updated=datetime('now')
      WHERE day=? AND status='selecting' AND NOT EXISTS (SELECT 1 FROM deliveries WHERE status IN ('pending','uncertain'))`)
      .bind(image.id,image.family,image.imageUrl,JSON.stringify(image),nonce,day).run();
    if (r.meta.changes !== 1) throw new StateError('Could not reserve daily delivery');
  }
  async finish(day, status, note = '', messageId = null) {
    if (!['sent','failed','uncertain','skipped'].includes(status)) throw new StateError('Invalid final state');
    const r = await this.db.prepare("UPDATE deliveries SET status=?,note=?,message_id=?,updated=datetime('now') WHERE day=? AND status IN ('selecting','pending')")
      .bind(status,note,messageId,day).run();
    if (r.meta.changes !== 1) throw new StateError('Could not persist delivery outcome; inspect database');
  }
}
