'use strict';

const fs = require('fs');
const path = require('path');

/*
 * Persistent leaderboard: every finished round adds one entry per hunter
 * (score, wave reached, foxes killed). Stored as JSON, kept to the best 200 rows.
 */
class Leaderboard {
  constructor(file) {
    this.file = file;
    this.entries = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.entries)) this.entries = data.entries;
    } catch {
      this.entries = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ entries: this.entries }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Leaderboard save failed:', err.message);
    }
  }

  recordRound(summary) {
    const date = new Date().toISOString();
    for (const r of summary.ranking) {
      this.entries.push({ name: r.name, score: r.score, wave: summary.wave, kills: r.kills, survived: r.survived, round: summary.round, date });
    }
    // Keep the file bounded: best by score, then wave, then kills.
    this.entries.sort((a, b) => b.score - a.score || b.wave - a.wave || b.kills - a.kills);
    this.entries = this.entries.slice(0, 200);
    this.save();
  }

  top(n = 5) {
    const by = (key) => [...this.entries].sort((a, b) => b[key] - a[key] || b.score - a.score).slice(0, n);
    return { bestRound: by('score'), highestWave: by('wave'), mostKills: by('kills'), total: this.entries.length };
  }
}

module.exports = { Leaderboard };
