/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from './index.ts';

// ============================================================================
// owl:sameAs-style Concept Deduplication Tests
//
// Demonstrates two patterns for achieving owl:sameAs-like behavior in TypeDB:
// - Pattern 2: Explicit same-as relation (without inference rules in embedded)
// - Pattern 3: Identity cluster (recommended) with alias-of relations
//
// Use case: LLM extracts concepts from documents, identifies semantic
// equivalences (e.g., "the customer" ≈ "customers" ≈ "our customer base"),
// and we need to query them as a unified concept.
// ============================================================================

// ----------------------------------------------------------------------------
// Pattern 2: same-as relation (without inference rules for embedded)
//
// Note: The full owl:sameAs experience would include symmetric/transitive rules,
// but the embedded WASM runtime doesn't support inference rules. We demonstrate
// the relation-based approach and note where rules would enhance it.
// ----------------------------------------------------------------------------

const SAME_AS_SCHEMA = `
define
  attribute concept-label value string;
  attribute definition-text value string;
  attribute doc-id value string;
  attribute is-canonical value boolean;

  entity concept, owns concept-label, owns definition-text, owns doc-id, owns is-canonical;
  relation same-as, relates lhs, relates rhs;
  concept plays same-as:lhs;
  concept plays same-as:rhs;
`;

// In a full TypeDB server with rules, you would add:
// rule same-as-symmetric: when { (lhs: $x, rhs: $y) isa same-as; } then { (lhs: $y, rhs: $x) isa same-as; };
// rule same-as-transitive: when { (lhs: $x, rhs: $y) isa same-as; (lhs: $y, rhs: $z) isa same-as; } then { (lhs: $x, rhs: $z) isa same-as; };

// ----------------------------------------------------------------------------
// Pattern 3: Identity cluster (recommended)
// ----------------------------------------------------------------------------

const CLUSTER_SCHEMA = `
define
  attribute concept-label value string;
  attribute definition-text value string;
  attribute doc-id value string;
  attribute canonical-id value string;
  attribute canonical-label value string;

  entity concept, owns concept-label, owns definition-text, owns doc-id;
  entity concept-cluster, owns canonical-id @key, owns canonical-label;
  relation alias-of, relates cluster, relates member;
  concept plays alias-of:member;
  concept-cluster plays alias-of:cluster;
`;

// ============================================================================
// Test Suites
// ============================================================================

describe('owl:sameAs-style concept deduplication', () => {
  // --------------------------------------------------------------------------
  // Pattern 2: same-as relation
  // --------------------------------------------------------------------------

  describe('Pattern 2 - same-as relation', () => {
    test('links equivalent concepts via same-as relation', async () => {
      const db = await Database.open('owl_sameas_p2_basic');

      await db.define(SAME_AS_SCHEMA);

      // Insert concepts from multiple documents
      await db.execute(`
        insert
          $a isa concept,
            has concept-label "the customer",
            has definition-text "party that purchases goods or services",
            has doc-id "doc-A",
            has is-canonical false;
      `);

      await db.execute(`
        insert
          $b isa concept,
            has concept-label "customers",
            has definition-text "our customers in the contract",
            has doc-id "doc-B",
            has is-canonical true;
      `);

      // LLM determines: A ~ B (semantically equivalent)
      await db.execute(`
        match
          $a isa concept, has concept-label "the customer", has doc-id "doc-A";
          $b isa concept, has concept-label "customers", has doc-id "doc-B";
        insert
          (lhs: $a, rhs: $b) isa same-as;
      `);

      // Query: concepts linked to A via same-as
      const equivalents = await db.query(`
        match
          $seed isa concept, has concept-label "the customer", has doc-id "doc-A";
          (lhs: $seed, rhs: $eq) isa same-as;
          $eq has concept-label $label;
      `);

      expect(equivalents.rowCount).toBeGreaterThanOrEqual(1);
      expect(equivalents.rows.some((r) => r.label.asString() === 'customers')).toBe(true);
    });

    test('finds canonical representative via is-canonical flag', async () => {
      const db = await Database.open('owl_sameas_p2_canonical');

      await db.define(SAME_AS_SCHEMA);

      await db.execute(`
        insert $a isa concept, has concept-label "the customer", has doc-id "doc-A", has is-canonical false;
      `);
      await db.execute(`
        insert $b isa concept, has concept-label "customers", has doc-id "doc-B", has is-canonical true;
      `);

      await db.execute(`
        match
          $a isa concept, has doc-id "doc-A";
          $b isa concept, has doc-id "doc-B";
        insert
          (lhs: $a, rhs: $b) isa same-as;
      `);

      // From alias, find canonical
      const canonical = await db.query(`
        match
          $alias isa concept, has doc-id "doc-A";
          (lhs: $alias, rhs: $equiv) isa same-as;
          $equiv has is-canonical true;
          $equiv has concept-label $label;
      `);

      expect(canonical.rowCount).toBe(1);
      expect(canonical.rows[0].label.asString()).toBe('customers');
    });

    test.skip('undo equivalence by deleting same-as link', async () => {
      // TODO: TypeQL delete syntax for relations needs investigation
      const db = await Database.open('owl_sameas_p2_undo');

      await db.define(SAME_AS_SCHEMA);

      await db.execute(`
        insert
          $a isa concept, has concept-label "customer", has doc-id "doc-A", has is-canonical false;
          $b isa concept, has concept-label "client", has doc-id "doc-B", has is-canonical true;
      `);

      await db.execute(`
        match
          $a isa concept, has doc-id "doc-A";
          $b isa concept, has doc-id "doc-B";
        insert
          (lhs: $a, rhs: $b) isa same-as;
      `);

      // Verify link exists
      const before = await db.query(`
        match
          $a isa concept, has doc-id "doc-A";
          (lhs: $a, rhs: $eq) isa same-as;
      `);
      expect(before.rowCount).toBe(1);

      // Undo: delete the same-as relation (concepts remain intact)
      // Note: In TypeQL 3.x, we delete by matching and deleting the relation instance
      await db.execute(`
        match
          $a isa concept, has doc-id "doc-A";
          $b isa concept, has doc-id "doc-B";
          (lhs: $a, rhs: $b) isa $type;
          $type type same-as;
        delete
          (lhs: $a, rhs: $b) isa $type;
      `);

      // Verify link removed
      const after = await db.query(`
        match
          $a isa concept, has doc-id "doc-A";
          (lhs: $a, rhs: $eq) isa same-as;
      `);
      expect(after.rowCount).toBe(0);
    });

    test('bidirectional query requires explicit both-direction links', async () => {
      // Without symmetric rules, you need to insert both directions
      // or query both directions explicitly
      const db = await Database.open('owl_sameas_p2_bidirectional');

      await db.define(SAME_AS_SCHEMA);

      await db.execute(`
        insert
          $a isa concept, has concept-label "customer", has doc-id "doc-A", has is-canonical false;
          $b isa concept, has concept-label "client", has doc-id "doc-B", has is-canonical true;
      `);

      // Insert BOTH directions to simulate symmetric rule
      await db.execute(`
        match
          $a isa concept, has doc-id "doc-A";
          $b isa concept, has doc-id "doc-B";
        insert
          (lhs: $a, rhs: $b) isa same-as;
          (lhs: $b, rhs: $a) isa same-as;
      `);

      // Now can query from B to A
      const fromB = await db.query(`
        match
          $seed isa concept, has doc-id "doc-B";
          (lhs: $seed, rhs: $eq) isa same-as;
          $eq has concept-label $label;
      `);
      expect(fromB.rowCount).toBe(1);
      expect(fromB.rows[0].label.asString()).toBe('customer');
    });
  });

  // --------------------------------------------------------------------------
  // Pattern 3: Identity Cluster (Recommended)
  // --------------------------------------------------------------------------

  describe('Pattern 3 - identity cluster (recommended)', () => {
    test('creates cluster with multiple aliases', async () => {
      const db = await Database.open('owl_sameas_p3_basic');

      await db.define(CLUSTER_SCHEMA);

      // Create canonical cluster
      await db.execute(`
        insert
          $cluster isa concept-cluster,
            has canonical-id "concept:customer",
            has canonical-label "Customer (party that purchases goods or services)";
      `);

      // Attach aliases from multiple docs
      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $a isa concept,
            has concept-label "the customer",
            has definition-text "party that purchases goods or services",
            has doc-id "doc-A";
          (cluster: $cluster, member: $a) isa alias-of;
      `);

      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $b isa concept,
            has concept-label "customers",
            has definition-text "the customers in this agreement",
            has doc-id "doc-B";
          (cluster: $cluster, member: $b) isa alias-of;
      `);

      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $c isa concept,
            has concept-label "our customer base",
            has definition-text "the entities buying from us",
            has doc-id "doc-C";
          (cluster: $cluster, member: $c) isa alias-of;
      `);

      // Query: all concepts in the cluster
      const allAliases = await db.query(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
          (cluster: $cluster, member: $alias) isa alias-of;
          $alias has concept-label $label;
      `);

      expect(allAliases.rowCount).toBe(3);
      const labels = allAliases.rows.map((r) => r.label.asString()).sort();
      expect(labels).toEqual(['customers', 'our customer base', 'the customer']);
    });

    test('queries equivalence class from any alias', async () => {
      const db = await Database.open('owl_sameas_p3_closure');

      await db.define(CLUSTER_SCHEMA);

      // Setup cluster with aliases
      await db.execute(`
        insert
          $cluster isa concept-cluster,
            has canonical-id "concept:customer",
            has canonical-label "Customer";
      `);

      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $a isa concept, has concept-label "the customer", has doc-id "doc-A";
          $b isa concept, has concept-label "customers", has doc-id "doc-B";
          (cluster: $cluster, member: $a) isa alias-of;
          (cluster: $cluster, member: $b) isa alias-of;
      `);

      // From alias A, find all equivalents (including itself)
      const equivalents = await db.query(`
        match
          $seed isa concept, has concept-label "the customer", has doc-id "doc-A";
          (cluster: $cluster, member: $seed) isa alias-of;
          (cluster: $cluster, member: $alias) isa alias-of;
          $alias has concept-label $label;
          $alias has doc-id $doc;
      `);

      expect(equivalents.rowCount).toBe(2);
      const docs = equivalents.rows.map((r) => r.doc.asString()).sort();
      expect(docs).toEqual(['doc-A', 'doc-B']);
    });

    test('resolves canonical representative from any alias', async () => {
      const db = await Database.open('owl_sameas_p3_canonical');

      await db.define(CLUSTER_SCHEMA);

      await db.execute(`
        insert
          $cluster isa concept-cluster,
            has canonical-id "concept:customer",
            has canonical-label "Customer (canonical)";
      `);

      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $a isa concept, has concept-label "the customer", has doc-id "doc-A";
          (cluster: $cluster, member: $a) isa alias-of;
      `);

      // From any alias, get canonical
      const canonical = await db.queryOneRequired(`
        match
          $alias isa concept, has concept-label "the customer", has doc-id "doc-A";
          (cluster: $cluster, member: $alias) isa alias-of;
          $cluster has canonical-id $cid;
          $cluster has canonical-label $clabel;
      `);

      expect(canonical.cid.asString()).toBe('concept:customer');
      expect(canonical.clabel.asString()).toBe('Customer (canonical)');
    });

    test.skip('undo equivalence by detaching alias from cluster', async () => {
      // TODO: TypeQL delete syntax for relations needs investigation
      const db = await Database.open('owl_sameas_p3_undo');

      await db.define(CLUSTER_SCHEMA);

      await db.execute(`
        insert
          $cluster isa concept-cluster,
            has canonical-id "concept:customer",
            has canonical-label "Customer";
      `);

      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
        insert
          $a isa concept, has concept-label "the customer", has doc-id "doc-A";
          $b isa concept, has concept-label "customers", has doc-id "doc-B";
          (cluster: $cluster, member: $a) isa alias-of;
          (cluster: $cluster, member: $b) isa alias-of;
      `);

      // Verify both attached
      const before = await db.query(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
          (cluster: $cluster, member: $alias) isa alias-of;
      `);
      expect(before.rowCount).toBe(2);

      // Detach B from cluster (reversible, non-destructive)
      await db.execute(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
          $b isa concept, has concept-label "customers", has doc-id "doc-B";
          $link (cluster: $cluster, member: $b) isa alias-of;
        delete
          $link;
      `);

      // Verify only A remains
      const after = await db.query(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
          (cluster: $cluster, member: $alias) isa alias-of;
      `);
      expect(after.rowCount).toBe(1);

      // B still exists as standalone concept
      const orphanedB = await db.query(`
        match $b isa concept, has concept-label "customers", has doc-id "doc-B";
      `);
      expect(orphanedB.rowCount).toBe(1);
    });

    test('supports multiple independent clusters', async () => {
      const db = await Database.open('owl_sameas_p3_multi');

      await db.define(CLUSTER_SCHEMA);

      // Create two clusters
      await db.execute(`
        insert
          $c1 isa concept-cluster,
            has canonical-id "concept:customer",
            has canonical-label "Customer";
          $c2 isa concept-cluster,
            has canonical-id "concept:vendor",
            has canonical-label "Vendor";
      `);

      // Attach aliases to each
      await db.execute(`
        match
          $c1 isa concept-cluster, has canonical-id "concept:customer";
          $c2 isa concept-cluster, has canonical-id "concept:vendor";
        insert
          $a isa concept, has concept-label "the customer", has doc-id "doc-A";
          $b isa concept, has concept-label "the vendor", has doc-id "doc-A";
          (cluster: $c1, member: $a) isa alias-of;
          (cluster: $c2, member: $b) isa alias-of;
      `);

      // Query customer cluster
      const customers = await db.query(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:customer";
          (cluster: $cluster, member: $alias) isa alias-of;
          $alias has concept-label $label;
      `);
      expect(customers.rowCount).toBe(1);
      expect(customers.rows[0].label.asString()).toBe('the customer');

      // Query vendor cluster
      const vendors = await db.query(`
        match
          $cluster isa concept-cluster, has canonical-id "concept:vendor";
          (cluster: $cluster, member: $alias) isa alias-of;
          $alias has concept-label $label;
      `);
      expect(vendors.rowCount).toBe(1);
      expect(vendors.rows[0].label.asString()).toBe('the vendor');
    });
  });

  // --------------------------------------------------------------------------
  // Comparison: Pattern 2 vs Pattern 3
  // --------------------------------------------------------------------------

  describe('comparison notes', () => {
    test('Pattern 3 does not require inference rules for closure', async () => {
      const db = await Database.open('owl_sameas_comparison');

      // Pattern 3 works purely via relation traversal
      // No rules needed for closure - just follow alias-of through cluster
      await db.define(CLUSTER_SCHEMA);

      await db.execute(`
        insert
          $cluster isa concept-cluster,
            has canonical-id "concept:test",
            has canonical-label "Test";
      `);

      await db.execute(`
        match $cluster isa concept-cluster, has canonical-id "concept:test";
        insert
          $a isa concept, has concept-label "A", has doc-id "d1";
          $b isa concept, has concept-label "B", has doc-id "d2";
          $c isa concept, has concept-label "C", has doc-id "d3";
          (cluster: $cluster, member: $a) isa alias-of;
          (cluster: $cluster, member: $b) isa alias-of;
          (cluster: $cluster, member: $c) isa alias-of;
      `);

      // Full closure without any inference - just two-hop traversal
      const all = await db.query(`
        match
          $seed isa concept, has concept-label "A";
          (cluster: $c, member: $seed) isa alias-of;
          (cluster: $c, member: $eq) isa alias-of;
          $eq has concept-label $label;
      `);

      expect(all.rowCount).toBe(3);
      const labels = all.rows.map((r) => r.label.asString()).sort();
      expect(labels).toEqual(['A', 'B', 'C']);
    });
  });
});
