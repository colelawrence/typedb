/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'bun:test';
import { typeql, TypeQL } from './template.ts';

describe('typeql template literal', () => {
  describe('string escaping', () => {
    it('escapes strings in value context (adds quotes)', () => {
      const name = 'Alice';
      const query = typeql`match $p has name = ${name};`;
      expect(query).toBe('match $p has name = "Alice";');
    });

    it('escapes strings inside quotes (no extra quotes)', () => {
      const name = 'Alice';
      const query = typeql`match $p has name "${name}";`;
      expect(query).toBe('match $p has name "Alice";');
    });

    it('escapes double quotes in strings', () => {
      const name = 'Alice "The Great"';
      const query = typeql`match $p has name "${name}";`;
      expect(query).toBe('match $p has name "Alice \\"The Great\\"";');
    });

    it('escapes backslashes in strings', () => {
      const path = 'C:\\Users\\Alice';
      const query = typeql`match $p has path "${path}";`;
      expect(query).toBe('match $p has path "C:\\\\Users\\\\Alice";');
    });

    it('escapes newlines in strings', () => {
      const text = 'line1\nline2';
      const query = typeql`match $p has text "${text}";`;
      expect(query).toBe('match $p has text "line1\\nline2";');
    });

    it('escapes tabs in strings', () => {
      const text = 'col1\tcol2';
      const query = typeql`match $p has text "${text}";`;
      expect(query).toBe('match $p has text "col1\\tcol2";');
    });

    it('escapes carriage returns in strings', () => {
      const text = 'line1\r\nline2';
      const query = typeql`match $p has text "${text}";`;
      expect(query).toBe('match $p has text "line1\\r\\nline2";');
    });
  });

  describe('identifier context', () => {
    it('detects isa context', () => {
      const type = 'person';
      const query = typeql`match $p isa ${type};`;
      expect(query).toBe('match $p isa person;');
    });

    it('detects sub context', () => {
      const type = 'entity';
      const query = typeql`define person sub ${type};`;
      expect(query).toBe('define person sub entity;');
    });

    it('detects owns context', () => {
      const attr = 'name';
      const query = typeql`define person owns ${attr};`;
      expect(query).toBe('define person owns name;');
    });

    it('detects plays context', () => {
      const role = 'employee';
      const query = typeql`define person plays ${role};`;
      expect(query).toBe('define person plays employee;');
    });

    it('detects relates context', () => {
      const role = 'member';
      const query = typeql`define membership relates ${role};`;
      expect(query).toBe('define membership relates member;');
    });

    it('detects has context (attribute name)', () => {
      const attr = 'name';
      const query = typeql`match $p has ${attr} $n;`;
      expect(query).toBe('match $p has name $n;');
    });

    it('validates identifiers', () => {
      expect(() => {
        const invalid = '123-invalid';
        typeql`match $p isa ${invalid};`;
      }).toThrow(/Invalid TypeQL identifier/);
    });

    it('rejects identifiers with spaces', () => {
      expect(() => {
        const invalid = 'my type';
        typeql`match $p isa ${invalid};`;
      }).toThrow(/Invalid TypeQL identifier/);
    });

    it('allows hyphens in identifiers', () => {
      const type = 'my-type';
      const query = typeql`match $p isa ${type};`;
      expect(query).toBe('match $p isa my-type;');
    });

    it('allows underscores in identifiers', () => {
      const type = 'my_type';
      const query = typeql`match $p isa ${type};`;
      expect(query).toBe('match $p isa my_type;');
    });
  });

  describe('number values', () => {
    it('handles integers', () => {
      const age = 30;
      const query = typeql`match $p has age ${age};`;
      expect(query).toBe('match $p has age 30;');
    });

    it('handles floats', () => {
      const score = 3.14;
      const query = typeql`match $p has score ${score};`;
      expect(query).toBe('match $p has score 3.14;');
    });

    it('handles negative numbers', () => {
      const temp = -10;
      const query = typeql`match $p has temp ${temp};`;
      expect(query).toBe('match $p has temp -10;');
    });

    it('handles bigints', () => {
      const big = 9007199254740993n;
      const query = typeql`match $p has id ${big};`;
      expect(query).toBe('match $p has id 9007199254740993;');
    });

    it('rejects Infinity', () => {
      expect(() => {
        typeql`match $p has value ${Infinity};`;
      }).toThrow(/Cannot interpolate Infinity/);
    });

    it('rejects NaN', () => {
      expect(() => {
        typeql`match $p has value ${NaN};`;
      }).toThrow(/Cannot interpolate NaN/);
    });
  });

  describe('boolean values', () => {
    it('handles true', () => {
      const active = true;
      const query = typeql`match $p has active ${active};`;
      expect(query).toBe('match $p has active true;');
    });

    it('handles false', () => {
      const active = false;
      const query = typeql`match $p has active ${active};`;
      expect(query).toBe('match $p has active false;');
    });
  });

  describe('array values', () => {
    it('handles string arrays', () => {
      const tags = ['a', 'b', 'c'];
      const query = typeql`match $p has tag in ${tags};`;
      expect(query).toBe('match $p has tag in ["a", "b", "c"];');
    });

    it('handles number arrays', () => {
      const ids = [1, 2, 3];
      const query = typeql`match $p has id in ${ids};`;
      expect(query).toBe('match $p has id in [1, 2, 3];');
    });

    it('handles mixed arrays', () => {
      const values = ['text', 42, true];
      const query = typeql`match $p has value in ${values};`;
      expect(query).toBe('match $p has value in ["text", 42, true];');
    });

    it('escapes strings in arrays', () => {
      const names = ['Alice', 'Bob "Jr"'];
      const query = typeql`match $p has name in ${names};`;
      expect(query).toBe('match $p has name in ["Alice", "Bob \\"Jr\\""];');
    });
  });

  describe('Date values', () => {
    it('handles Date objects', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const query = typeql`match $p has created ${date};`;
      expect(query).toBe('match $p has created "2024-01-15T10:30:00.000Z";');
    });
  });

  describe('null and undefined', () => {
    it('rejects null', () => {
      expect(() => {
        typeql`match $p has value ${null};`;
      }).toThrow(/Cannot interpolate null/);
    });

    it('rejects undefined', () => {
      expect(() => {
        typeql`match $p has value ${undefined};`;
      }).toThrow(/Cannot interpolate null or undefined/);
    });
  });

  describe('TypeQL wrapper functions', () => {
    describe('TypeQL.str()', () => {
      it('forces string escaping with quotes', () => {
        const value = 'test';
        const query = typeql`match $p has name = ${TypeQL.str(value)};`;
        expect(query).toBe('match $p has name = "test";');
      });

      it('escapes special characters', () => {
        const value = 'has "quotes"';
        const query = typeql`match $p has name = ${TypeQL.str(value)};`;
        expect(query).toBe('match $p has name = "has \\"quotes\\"";');
      });
    });

    describe('TypeQL.ident()', () => {
      it('forces identifier treatment', () => {
        const type = 'person';
        const query = typeql`match $p isa ${TypeQL.ident(type)};`;
        expect(query).toBe('match $p isa person;');
      });

      it('validates the identifier', () => {
        expect(() => {
          typeql`match $p isa ${TypeQL.ident('123invalid')};`;
        }).toThrow(/Invalid TypeQL identifier/);
      });
    });

    describe('TypeQL.var()', () => {
      it('creates variable with $ prefix', () => {
        const varName = 'person';
        const query = typeql`match ${TypeQL.var(varName)} isa entity;`;
        expect(query).toBe('match $person isa entity;');
      });

      it('handles existing $ prefix', () => {
        const varName = '$person';
        const query = typeql`match ${TypeQL.var(varName)} isa entity;`;
        expect(query).toBe('match $person isa entity;');
      });

      it('validates variable names', () => {
        expect(() => {
          typeql`match ${TypeQL.var('123invalid')} isa entity;`;
        }).toThrow(/Invalid TypeQL identifier/);
      });
    });

    describe('TypeQL.raw()', () => {
      it('inserts raw string without escaping', () => {
        const clause = '$p isa person';
        const query = typeql`match ${TypeQL.raw(clause)};`;
        expect(query).toBe('match $p isa person;');
      });

      it('does not escape special characters', () => {
        const clause = 'has name "Alice"';
        const query = typeql`match $p ${TypeQL.raw(clause)};`;
        expect(query).toBe('match $p has name "Alice";');
      });
    });

    describe('TypeQL.list()', () => {
      it('creates a list', () => {
        const values = ['a', 'b', 'c'];
        const query = typeql`match $p has tag in ${TypeQL.list(values)};`;
        expect(query).toBe('match $p has tag in ["a", "b", "c"];');
      });

      it('escapes values in list', () => {
        const values = ['has "quotes"', 'normal'];
        const query = typeql`match $p has tag in ${TypeQL.list(values)};`;
        expect(query).toBe('match $p has tag in ["has \\"quotes\\"", "normal"];');
      });
    });
  });

  describe('complex queries', () => {
    it('handles multiple interpolations', () => {
      const type = 'person';
      const name = 'Alice';
      const age = 30;

      const query = typeql`
        match
          $p isa ${type},
          has name "${name}",
          has age ${age};
      `;

      expect(query).toContain('$p isa person');
      expect(query).toContain('has name "Alice"');
      expect(query).toContain('has age 30');
    });

    it('handles nested quotes correctly', () => {
      const outer = 'value';
      const inner = 'quoted "value"';

      const query = typeql`match $p has outer "${outer}", has inner "${inner}";`;
      expect(query).toBe('match $p has outer "value", has inner "quoted \\"value\\"";');
    });

    it('handles define statements', () => {
      const entityName = 'person';
      const attrName = 'name';
      const attrType = 'string';

      const query = typeql`
        define
          ${TypeQL.ident(entityName)} sub entity, owns ${attrName};
          attribute ${attrName} value ${attrType};
      `;

      expect(query).toContain('person sub entity');
      expect(query).toContain('owns name');
      expect(query).toContain('attribute name value string');
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      const empty = '';
      const query = typeql`match $p has name "${empty}";`;
      expect(query).toBe('match $p has name "";');
    });

    it('handles strings with only special characters', () => {
      const special = '"\\\n\r\t';
      const query = typeql`match $p has text "${special}";`;
      expect(query).toBe('match $p has text "\\"\\\\\\n\\r\\t";');
    });

    it('handles zero', () => {
      const zero = 0;
      const query = typeql`match $p has count ${zero};`;
      expect(query).toBe('match $p has count 0;');
    });

    it('handles empty array', () => {
      const empty: string[] = [];
      const query = typeql`match $p has tag in ${empty};`;
      expect(query).toBe('match $p has tag in [];');
    });

    it('preserves whitespace in template', () => {
      const type = 'person';
      const query = typeql`match   $p   isa   ${type}  ;`;
      expect(query).toBe('match   $p   isa   person  ;');
    });
  });
});
