import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/components/${name}`, import.meta.url)), "utf8"));
const vector = read("characterData.json"), pixel = read("pixelCharacters.json");

test("every character slot has a well-formed, named 32x32 sprite with two eyes that blink and glance", () => {
  assert.equal(pixel.size, 32);
  assert.deepEqual(Object.keys(pixel.characters).sort(), Object.keys(vector.characters).sort());
  for (const [name, sprite] of Object.entries<any>(pixel.characters)) {
    assert.equal(sprite.rows.length, pixel.size, name);
    assert.ok(sprite.label, name);
    assert.ok(sprite.paints.length <= 10, `${name} paints fit single digits`);
    for (const row of sprite.rows) assert.match(row, new RegExp(`^[.opdsblh0-9]{${pixel.size}}$`), name);
    for (const row of sprite.rows) for (const cell of row.match(/[0-9]/g) || []) assert.ok(Number(cell) < sprite.paints.length, `${name} paint ${cell}`);
    const body = (x: number, y: number) => !".op".includes(sprite.rows[y]?.[x] ?? ".");
    // The outline closes the drawing: nothing drawn touches empty space.
    for (let y = 0; y < pixel.size; y++)
      for (let x = 0; x < pixel.size; x++)
        if (body(x, y)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(sprite.rows[y + dy]?.[x + dx] ?? ".", ".", `${name} ${x},${y}`);
    assert.equal(sprite.eyes.length, 2, name);
    assert.equal(sprite.closed.length, 2, name);
    // Eyes, their glint and the closed lids stay on the face even when glancing a pixel aside.
    for (const [x, y] of [...sprite.eyes.flat(), ...sprite.shine, ...sprite.closed.flat()])
      for (const dx of [-1, 0, 1]) assert.ok(body(x + dx, y), `${name} eye ${x + dx},${y}`);
    for (const [x, y] of sprite.shine) assert.ok(sprite.eyes.flat().some(([ex, ey]: number[]) => ex === x && ey === y), `${name} glint on an eye`);
  }
});
