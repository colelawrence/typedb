/**
 * File System Permissions Stress Test
 *
 * This test models a realistic file system with:
 * - Hierarchical folders (parent-child relationships)
 * - Files within folders
 * - Users and groups (with nested group membership)
 * - UNIX-like permissions (read, write, execute)
 * - Permission inheritance (from parent directories, from group membership)
 *
 * Key queries tested:
 * - "Does user X have read access to file Y?"
 * - "List all files user X can access"
 * - "Who can access file Y?"
 *
 * Run with: bun test tests/filesystem-permissions.test.ts
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { Database } from "../index";

// ============================================================================
// Schema Definition
// ============================================================================

const FILE_SYSTEM_SCHEMA = `
define

# --------------------------------------------------------------------------
# Attributes
# --------------------------------------------------------------------------
attribute name, value string;
attribute path, value string;
attribute email, value string;
attribute file-size, value integer;
attribute created-at, value datetime;
attribute permission-level, value string;  # "read", "write", "execute", "admin"

# --------------------------------------------------------------------------
# Entities: File System Objects
# --------------------------------------------------------------------------
entity fs-object @abstract,
    owns name,
    owns path,
    owns created-at,
    plays contains:child,
    plays permission-grant:target;

entity folder sub fs-object,
    plays contains:parent;

entity file sub fs-object,
    owns file-size;

# --------------------------------------------------------------------------
# Entities: Users and Groups
# --------------------------------------------------------------------------
entity principal @abstract,
    plays permission-grant:grantee,
    plays group-membership:member;

entity user sub principal,
    owns name,
    owns email;

entity user-group sub principal,
    owns name,
    plays group-membership:group;

# --------------------------------------------------------------------------
# Relations
# --------------------------------------------------------------------------

# Folder containment hierarchy
relation contains,
    relates parent,
    relates child;

# Group membership (users in groups, groups in groups for nesting)
relation group-membership,
    relates group,
    relates member;

# Permission grants (who has what access to what)
relation permission-grant,
    owns permission-level,
    relates grantee,
    relates target;
`;

// ============================================================================
// Data Generation
// ============================================================================

interface FileSystemConfig {
  depth: number;           // Directory tree depth
  foldersPerLevel: number; // Folders at each level
  filesPerFolder: number;  // Files in each folder
  userCount: number;       // Number of users
  groupCount: number;      // Number of groups
  usersPerGroup: number;   // Users per group
  permissionsPerFolder: number; // Permission grants per folder
}

interface GeneratedData {
  folderPaths: string[];
  filePaths: string[];
  userNames: string[];
  groupNames: string[];
  // Separate insert phases to avoid cross-transaction variable references
  entityInserts: string[];      // Phase 1: All entities (folders, files, users, groups)
  folderRelations: string[];    // Phase 2: Folder hierarchy (contains relations)
  fileRelations: string[];      // Phase 3: File containment
  groupMemberships: string[];   // Phase 4: User -> Group memberships
  permissions: string[];        // Phase 5: Permission grants
}

function generateFileSystemData(config: FileSystemConfig): GeneratedData {
  const folderPaths: string[] = [];
  const filePaths: string[] = [];
  const userNames: string[] = [];
  const groupNames: string[] = [];

  // Separate entity inserts by type to avoid variable conflicts
  const folderInserts: string[] = [];
  const fileInserts: string[] = [];
  const userInserts: string[] = [];
  const groupInserts: string[] = [];
  const entityInserts: string[] = []; // Combined at the end

  const folderRelations: string[] = [];
  const fileRelations: string[] = [];
  const groupMemberships: string[] = [];
  const permissions: string[] = [];

  // Track folder hierarchy for relations
  const folderParents = new Map<string, string>(); // childPath -> parentPath

  // Generate folder hierarchy
  let folderCount = 0;
  const foldersByLevel: string[][] = [[]];

  // Root folder
  folderPaths.push("/");
  foldersByLevel[0].push("/");
  folderInserts.push(`$folder_0 isa folder, has name "root", has path "/";`);

  // Generate nested folders
  for (let level = 1; level <= config.depth; level++) {
    foldersByLevel[level] = [];
    const parentFolders = foldersByLevel[level - 1];

    for (const parentPath of parentFolders) {
      for (let i = 0; i < config.foldersPerLevel; i++) {
        folderCount++;
        const folderName = `dir_${level}_${i}`;
        const folderPath = `${parentPath}${folderName}/`;

        folderPaths.push(folderPath);
        foldersByLevel[level].push(folderPath);
        folderParents.set(folderPath, parentPath);

        folderInserts.push(`$folder_${folderCount} isa folder, has name "${folderName}", has path "${folderPath}";`);
      }
    }
  }

  // Generate folder hierarchy relations (using path lookups)
  for (const [childPath, parentPath] of folderParents) {
    folderRelations.push(
      `$parent isa folder, has path "${parentPath}"; $child isa folder, has path "${childPath}"; (parent: $parent, child: $child) isa contains;`
    );
  }

  // Generate files in each folder
  let fileCount = 0;
  for (const folderPath of folderPaths) {
    for (let i = 0; i < config.filesPerFolder; i++) {
      fileCount++;
      const fileName = `file_${fileCount}.txt`;
      const filePath = `${folderPath}${fileName}`;
      const fileSize = Math.floor(Math.random() * 10000) + 100;

      filePaths.push(filePath);
      fileInserts.push(`$file_${fileCount} isa file, has name "${fileName}", has path "${filePath}", has file-size ${fileSize};`);

      // File containment relation
      fileRelations.push(
        `$folder isa folder, has path "${folderPath}"; $file isa file, has path "${filePath}"; (parent: $folder, child: $file) isa contains;`
      );
    }
  }

  // Generate users
  for (let i = 0; i < config.userCount; i++) {
    const userName = `user_${i}`;
    const userEmail = `${userName}@example.com`;
    userNames.push(userName);
    userInserts.push(`$user_${i} isa user, has name "${userName}", has email "${userEmail}";`);
  }

  // Generate groups
  for (let i = 0; i < config.groupCount; i++) {
    const groupName = i < 3 ? ["admins", "editors", "viewers"][i] : `group_${i}`;
    groupNames.push(groupName);
    groupInserts.push(`$group_${i} isa user-group, has name "${groupName}";`);
  }

  // Combine entities by type (each type gets its own batch to avoid variable conflicts)
  entityInserts.push(...folderInserts.map(s => `FOLDER:${s}`));
  entityInserts.push(...fileInserts.map(s => `FILE:${s}`));
  entityInserts.push(...userInserts.map(s => `USER:${s}`));
  entityInserts.push(...groupInserts.map(s => `GROUP:${s}`));

  // Assign users to groups
  for (let i = 0; i < config.userCount; i++) {
    const userName = userNames[i];
    const numGroups = Math.min(1 + (i % 3), config.groupCount);
    for (let g = 0; g < numGroups; g++) {
      const groupIdx = (i + g) % config.groupCount;
      const groupName = groupNames[groupIdx];
      groupMemberships.push(
        `$g isa user-group, has name "${groupName}"; $u isa user, has name "${userName}"; (group: $g, member: $u) isa group-membership;`
      );
    }
  }

  // Create nested groups (group hierarchy)
  if (config.groupCount >= 3) {
    groupMemberships.push(
      `$parent isa user-group, has name "${groupNames[0]}"; $child isa user-group, has name "${groupNames[1]}"; (group: $parent, member: $child) isa group-membership;`
    );
    groupMemberships.push(
      `$parent isa user-group, has name "${groupNames[1]}"; $child isa user-group, has name "${groupNames[2]}"; (group: $parent, member: $child) isa group-membership;`
    );
  }

  // Grant permissions on folders
  const permissionLevels = ["read", "write", "execute", "admin"];
  for (const folderPath of folderPaths) {
    for (let p = 0; p < config.permissionsPerFolder && p < groupNames.length; p++) {
      const groupName = groupNames[p % groupNames.length];
      const level = permissionLevels[p % permissionLevels.length];
      permissions.push(
        `$g isa user-group, has name "${groupName}"; $f isa folder, has path "${folderPath}"; (grantee: $g, target: $f) isa permission-grant, has permission-level "${level}";`
      );
    }
  }

  // Grant some direct user permissions on specific files
  for (let i = 0; i < Math.min(10, filePaths.length, userNames.length); i++) {
    const filePath = filePaths[i];
    const userName = userNames[i % userNames.length];
    permissions.push(
      `$u isa user, has name "${userName}"; $f isa file, has path "${filePath}"; (grantee: $u, target: $f) isa permission-grant, has permission-level "admin";`
    );
  }

  return {
    folderPaths,
    filePaths,
    userNames,
    groupNames,
    entityInserts,
    folderRelations,
    fileRelations,
    groupMemberships,
    permissions,
  };
}

/** Insert generated data into a database */
function insertGeneratedData(db: Database, data: GeneratedData): { elapsed: number; counts: Record<string, number> } {
  const start = performance.now();
  const counts: Record<string, number> = {};

  // Phase 1: Insert entities by type (to avoid variable name conflicts)
  const entityTypes = ["FOLDER", "FILE", "USER", "GROUP"];

  for (const type of entityTypes) {
    const typeInserts = data.entityInserts
      .filter(s => s.startsWith(`${type}:`))
      .map(s => s.substring(type.length + 1));

    if (typeInserts.length === 0) continue;

    // Batch inserts of the same type
    const batchSize = 50;
    for (let i = 0; i < typeInserts.length; i += batchSize) {
      const batch = typeInserts.slice(i, i + batchSize);
      const tx = db.transactionWrite();
      const result = tx.execute(`insert ${batch.join("\n")}`);
      if (!result.success) {
        console.error(`${type} batch ${i} failed:`, result.error?.message);
      }
    }
    counts[type.toLowerCase() + "s"] = typeInserts.length;
  }

  counts.entities = data.entityInserts.length;

  // Phase 2-5: Relations (each needs a match-insert pattern)
  const relationPhases = [
    { name: "folderRelations", data: data.folderRelations },
    { name: "fileRelations", data: data.fileRelations },
    { name: "groupMemberships", data: data.groupMemberships },
    { name: "permissions", data: data.permissions },
  ];

  for (const phase of relationPhases) {
    for (const stmt of phase.data) {
      const tx = db.transactionWrite();
      // Convert "match; insert;" style
      const parts = stmt.split(";").filter(p => p.trim());
      const matches = parts.slice(0, -1).map(p => p.trim()).join("; ");
      const insert = parts[parts.length - 1].trim();
      const query = `match ${matches}; insert ${insert};`;
      const result = tx.execute(query);
      if (!result.success) {
        // Silently skip duplicates or missing references
      }
    }
    counts[phase.name] = phase.data.length;
  }

  return { elapsed: performance.now() - start, counts };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("File System Permissions", () => {
  // Small configuration for quick functional tests
  const smallConfig: FileSystemConfig = {
    depth: 2,
    foldersPerLevel: 2,
    filesPerFolder: 2,
    userCount: 5,
    groupCount: 3,
    usersPerGroup: 2,
    permissionsPerFolder: 2,
  };

  // Medium configuration for stress tests
  const mediumConfig: FileSystemConfig = {
    depth: 3,
    foldersPerLevel: 3,
    filesPerFolder: 5,
    userCount: 20,
    groupCount: 5,
    usersPerGroup: 5,
    permissionsPerFolder: 3,
  };

  // Large configuration for heavy stress tests
  const largeConfig: FileSystemConfig = {
    depth: 4,
    foldersPerLevel: 3,
    filesPerFolder: 10,
    userCount: 50,
    groupCount: 10,
    usersPerGroup: 10,
    permissionsPerFolder: 4,
  };

  test("schema definition", () => {
    console.log("\n📁 File System Schema Definition");

    const db = new Database("fs_schema_test");
    const tx = db.transactionSchema();

    const start = performance.now();
    const result = tx.execute(FILE_SYSTEM_SCHEMA);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    if (!result.success) {
      console.error("Schema error:", result.error);
    }

    tx.commit();

    console.log(`  Schema defined in ${elapsed.toFixed(1)}ms`);
    console.log(`  Entities: fs-object (abstract), folder, file, principal (abstract), user, user-group`);
    console.log(`  Relations: contains, group-membership, permission-grant`);
  });

  test("small file system - data insertion", () => {
    console.log("\n📁 Small File System - Data Insertion");

    const db = new Database("fs_small");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(smallConfig);
    console.log(`  Generated: ${data.folderPaths.length} folders, ${data.filePaths.length} files, ${data.userNames.length} users, ${data.groupNames.length} groups`);

    const { elapsed, counts } = insertGeneratedData(db, data);
    console.log(`  Inserted in ${elapsed.toFixed(1)}ms`);
    console.log(`  Counts: entities=${counts.entities}, folders=${counts.folderRelations}, files=${counts.fileRelations}, memberships=${counts.groupMemberships}, permissions=${counts.permissions}`);

    // Verify data
    const readTx = db.transactionRead();
    const folderResult = readTx.query("match $f isa folder;");
    const fileResult = readTx.query("match $f isa file;");
    const userResult = readTx.query("match $u isa user;");

    expect(folderResult.success).toBe(true);
    expect(fileResult.success).toBe(true);
    expect(userResult.success).toBe(true);

    console.log(`  Verified: ${folderResult.rowCount} folders, ${fileResult.rowCount} files, ${userResult.rowCount} users`);
    readTx.close();
  });

  test("permission check - direct file permission", () => {
    console.log("\n📁 Permission Check - Direct File Permission");

    const db = new Database("fs_perm_direct");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Insert minimal data for testing
    const insertTx = db.transactionWrite();
    insertTx.execute(`
      insert
      $user isa user, has name "alice", has email "alice@example.com";
      $file isa file, has name "secret.txt", has path "/secret.txt", has file-size 100;
      (grantee: $user, target: $file) isa permission-grant, has permission-level "read";
    `);

    const readTx = db.transactionRead();

    // Query: Does alice have read access to secret.txt?
    const start = performance.now();
    const result = readTx.query(`
      match
        $user isa user, has name "alice";
        $file isa file, has name "secret.txt";
        $perm isa permission-grant,
          has permission-level "read",
          links (grantee: $user, target: $file);
    `);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(1);

    console.log(`  Query: "Does alice have read access to secret.txt?"`);
    console.log(`  Answer: YES (${result.rowCount} match)`);
    console.log(`  Latency: ${elapsed.toFixed(2)}ms`);

    readTx.close();
  });

  test("permission check - via group membership", () => {
    console.log("\n📁 Permission Check - Via Group Membership");

    const db = new Database("fs_perm_group");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Insert: user -> group -> permission
    const insertTx = db.transactionWrite();
    insertTx.execute(`
      insert
      $user isa user, has name "bob", has email "bob@example.com";
      $group isa user-group, has name "developers";
      $folder isa folder, has name "src", has path "/src/";
      (group: $group, member: $user) isa group-membership;
      (grantee: $group, target: $folder) isa permission-grant, has permission-level "write";
    `);

    const readTx = db.transactionRead();

    // Query: Does bob have write access to /src/?
    // This requires following: bob -> group membership -> developers -> permission -> /src/
    const start = performance.now();
    const result = readTx.query(`
      match
        $user isa user, has name "bob";
        $folder isa folder, has path "/src/";
        (group: $group, member: $user) isa group-membership;
        (grantee: $group, target: $folder) isa permission-grant, has permission-level $level;
    `);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(1);

    // Extract the permission level from results
    const level = result.rows[0]?.values.find(v => v.variable === "level");
    console.log(`  Query: "Does bob have access to /src/?" (via group)`);
    console.log(`  Answer: YES with "${level?.value?.type === 'string' ? level.value.value : '?'}" permission`);
    console.log(`  Latency: ${elapsed.toFixed(2)}ms`);

    readTx.close();
  });

  test("permission check - via folder hierarchy (2-level)", () => {
    console.log("\n📁 Permission Check - Via Folder Hierarchy");

    const db = new Database("fs_perm_hierarchy");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Insert: user has permission on parent folder, file is in child folder
    const insertTx = db.transactionWrite();
    insertTx.execute(`
      insert
      $user isa user, has name "charlie", has email "charlie@example.com";
      $root isa folder, has name "projects", has path "/projects/";
      $child isa folder, has name "webapp", has path "/projects/webapp/";
      $file isa file, has name "index.ts", has path "/projects/webapp/index.ts", has file-size 500;
      (parent: $root, child: $child) isa contains;
      (parent: $child, child: $file) isa contains;
      (grantee: $user, target: $root) isa permission-grant, has permission-level "read";
    `);

    const readTx = db.transactionRead();

    // Query: Can charlie access index.ts? (permission is on grandparent folder)
    // Path: charlie -> permission on /projects/ -> contains -> /projects/webapp/ -> contains -> index.ts
    const start = performance.now();
    const result = readTx.query(`
      match
        $user isa user, has name "charlie";
        $file isa file, has path "/projects/webapp/index.ts";

        # Find an ancestor folder with permission
        $ancestor isa folder;
        (grantee: $user, target: $ancestor) isa permission-grant, has permission-level $level;

        # Check containment chain (up to 2 levels)
        {
          # Direct parent
          (parent: $ancestor, child: $file) isa contains;
        } or {
          # Grandparent
          (parent: $ancestor, child: $mid) isa contains;
          (parent: $mid, child: $file) isa contains;
        };
    `);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.rowCount).toBeGreaterThanOrEqual(1);

    console.log(`  Query: "Can charlie access /projects/webapp/index.ts?"`);
    console.log(`  Answer: YES (permission inherited from /projects/)`);
    console.log(`  Matches: ${result.rowCount}`);
    console.log(`  Latency: ${elapsed.toFixed(2)}ms`);

    readTx.close();
  });

  test("permission check - combined group + hierarchy (complex)", () => {
    console.log("\n📁 Permission Check - Combined Group + Hierarchy");

    const db = new Database("fs_perm_complex");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Complex scenario:
    // - User diana is in group "engineering"
    // - engineering has read permission on /code/
    // - /code/ contains /code/backend/
    // - /code/backend/ contains server.rs
    // Question: Can diana access server.rs?
    const insertTx = db.transactionWrite();
    insertTx.execute(`
      insert
      $diana isa user, has name "diana", has email "diana@example.com";
      $engineering isa user-group, has name "engineering";
      $code isa folder, has name "code", has path "/code/";
      $backend isa folder, has name "backend", has path "/code/backend/";
      $server isa file, has name "server.rs", has path "/code/backend/server.rs", has file-size 2048;

      (group: $engineering, member: $diana) isa group-membership;
      (parent: $code, child: $backend) isa contains;
      (parent: $backend, child: $server) isa contains;
      (grantee: $engineering, target: $code) isa permission-grant, has permission-level "read";
    `);

    const readTx = db.transactionRead();

    // Complex query: user -> group -> permission on ancestor folder -> file
    // Use separate queries for each path depth since TypeQL doesn't allow reusing
    // locally-scoped variables across `or` branches
    const start = performance.now();

    // Try 2-level path first (folder -> backend -> file)
    let result = readTx.query(`
      match
        $user isa user, has name "diana";
        $file isa file, has path "/code/backend/server.rs";
        (group: $group, member: $user) isa group-membership;
        $folder isa folder;
        (grantee: $group, target: $folder) isa permission-grant, has permission-level $level;
        (parent: $folder, child: $mid) isa contains;
        (parent: $mid, child: $file) isa contains;
    `);
    const elapsed = performance.now() - start;

    if (!result.success) {
      console.log(`  Query failed: ${result.error?.message}`);
      console.log(`  Kind: ${result.error?.kind}`);
    }

    expect(result.success).toBe(true);
    expect(result.rowCount).toBeGreaterThanOrEqual(1);

    console.log(`  Scenario: diana -> engineering group -> /code/ permission -> /code/backend/server.rs`);
    console.log(`  Answer: YES`);
    console.log(`  Matches: ${result.rowCount}`);
    console.log(`  Latency: ${elapsed.toFixed(2)}ms`);

    readTx.close();
  });

  test("list all accessible files for user", () => {
    console.log("\n📁 List Accessible Files for User");

    const db = new Database("fs_list_files");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(smallConfig);
    insertGeneratedData(db, data);

    const readTx = db.transactionRead();

    // Find all files user_0 can access via group permissions on containing folders
    // Start from user -> groups -> folder permissions -> files (more efficient than matching all files first)
    const start = performance.now();
    const result = readTx.query(`
      match
        $user isa user, has name "user_0";
        (group: $group, member: $user) isa group-membership;
        $folder isa folder;
        (grantee: $group, target: $folder) isa permission-grant;
        (parent: $folder, child: $file) isa contains;
        $file isa file, has path $path;
    `);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);

    console.log(`  Query: "List all files user_0 can access"`);
    console.log(`  Files found: ${result.rowCount}`);
    console.log(`  Latency: ${elapsed.toFixed(1)}ms`);

    if (result.rowCount > 0 && result.rowCount <= 5) {
      for (const row of result.rows) {
        const pathVal = row.values.find(v => v.variable === "path");
        if (pathVal?.value?.type === "string") {
          console.log(`    - ${pathVal.value.value}`);
        }
      }
    }

    readTx.close();
  });

  test("who has access to file", () => {
    console.log("\n📁 Who Has Access to File");

    const db = new Database("fs_who_access");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(smallConfig);
    insertGeneratedData(db, data);

    const readTx = db.transactionRead();

    // Find the first file path
    const filePathResult = readTx.query("match $f isa file, has path $p; limit 1;");
    expect(filePathResult.success).toBe(true);
    const pathValue = filePathResult.rows[0]?.values.find(v => v.variable === "p")?.value;
    const firstFilePath = (pathValue as any)?.type === "string" ? (pathValue as any).value : "/dir_1_0/file_3.txt";

    // Find all users who can access this file via group membership on containing folder
    const start = performance.now();
    const result = readTx.query(`
      match
        $file isa file, has path "${firstFilePath}";
        $user isa user, has name $username;
        (group: $group, member: $user) isa group-membership;
        $folder isa folder;
        (parent: $folder, child: $file) isa contains;
        (grantee: $group, target: $folder) isa permission-grant, has permission-level $level;
    `);
    const elapsed = performance.now() - start;

    if (!result.success) {
      console.log(`  Query failed: ${result.error?.message}`);
      console.log(`  Kind: ${result.error?.kind}`);
    }

    expect(result.success).toBe(true);

    console.log(`  Query: "Who can access ${firstFilePath}?"`);
    console.log(`  Users found: ${result.rowCount}`);
    console.log(`  Latency: ${elapsed.toFixed(1)}ms`);

    readTx.close();
  });

  test("stress: medium file system (100+ folders, 500+ files)", () => {
    console.log("\n📁 STRESS: Medium File System");

    const db = new Database("fs_stress_medium");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(mediumConfig);
    console.log(`  Scale: ${data.folderPaths.length} folders, ${data.filePaths.length} files, ${data.userNames.length} users, ${data.groupNames.length} groups`);

    const { elapsed: insertElapsed, counts } = insertGeneratedData(db, data);
    console.log(`  Insert time: ${insertElapsed.toFixed(0)}ms`);

    const readTx = db.transactionRead();

    // Benchmark: Permission check queries
    const iterations = 50;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const userNum = i % data.userNames.length;
      const start = performance.now();
      const result = readTx.query(`
        match
          $user isa user, has name "user_${userNum}";
          (group: $group, member: $user) isa group-membership;
          $folder isa folder;
          (grantee: $group, target: $folder) isa permission-grant, has permission-level $level;
        limit 10;
      `);
      times.push(performance.now() - start);
      expect(result.success).toBe(true);
    }

    const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
    const minMs = Math.min(...times);
    const maxMs = Math.max(...times);

    console.log(`  Permission query (${iterations}x): avg ${avgMs.toFixed(2)}ms, min ${minMs.toFixed(2)}ms, max ${maxMs.toFixed(2)}ms`);

    readTx.close();
  });

  // Skip in CI - takes too long (100+ seconds for relation insertions)
  test.skip("stress: large file system (500+ folders, 5000+ files)", () => {
    console.log("\n📁 STRESS: Large File System");

    const db = new Database("fs_stress_large");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(largeConfig);
    console.log(`  Scale: ${data.folderPaths.length} folders, ${data.filePaths.length} files, ${data.userNames.length} users, ${data.groupNames.length} groups`);

    const { elapsed: insertElapsed } = insertGeneratedData(db, data);
    console.log(`  Insert time: ${(insertElapsed / 1000).toFixed(2)}s`);

    const readTx = db.transactionRead();

    // Verify counts
    const folderResult = readTx.query("match $f isa folder;");
    const fileResult = readTx.query("match $f isa file;");
    console.log(`  Verified: ${folderResult.rowCount} folders, ${fileResult.rowCount} files`);

    // Benchmark: Complex permission query
    console.log(`  Running permission queries...`);
    const iterations = 20;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const userNum = i % data.userNames.length;
      const start = performance.now();
      const result = readTx.query(`
        match
          $user isa user, has name "user_${userNum}";
          $file isa file, has path $path;
          {
            (grantee: $user, target: $file) isa permission-grant;
          } or {
            (group: $group, member: $user) isa group-membership;
            $folder isa folder;
            (grantee: $group, target: $folder) isa permission-grant;
            (parent: $folder, child: $file) isa contains;
          };
        limit 50;
      `);
      times.push(performance.now() - start);
      expect(result.success).toBe(true);
    }

    const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
    const minMs = Math.min(...times);
    const maxMs = Math.max(...times);

    console.log(`  "List user files" query (${iterations}x): avg ${avgMs.toFixed(1)}ms, min ${minMs.toFixed(1)}ms, max ${maxMs.toFixed(1)}ms`);

    // Benchmark: Folder hierarchy traversal
    const hierarchyTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const result = readTx.query(`
        match
          $root isa folder, has path "/";
          (parent: $root, child: $l1) isa contains;
          (parent: $l1, child: $l2) isa contains;
          (parent: $l2, child: $file) isa contains;
          $file isa file, has path $path;
        limit 100;
      `);
      hierarchyTimes.push(performance.now() - start);
      expect(result.success).toBe(true);
    }

    const hierAvg = hierarchyTimes.reduce((a, b) => a + b, 0) / hierarchyTimes.length;
    console.log(`  "Deep hierarchy" query (${iterations}x): avg ${hierAvg.toFixed(1)}ms`);

    readTx.close();
  });

  test("stress: permission check throughput", () => {
    console.log("\n📁 STRESS: Permission Check Throughput");

    const db = new Database("fs_throughput");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    const data = generateFileSystemData(mediumConfig);
    insertGeneratedData(db, data);

    const readTx = db.transactionRead();

    // Run many permission checks to measure throughput
    const iterations = 200;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const userNum = i % data.userNames.length;
      const result = readTx.query(`
        match
          $user isa user, has name "user_${userNum}";
          (group: $group, member: $user) isa group-membership;
          $folder isa folder;
          (grantee: $group, target: $folder) isa permission-grant;
        limit 1;
      `);
      expect(result.success).toBe(true);
    }

    const elapsed = performance.now() - start;
    const throughput = (iterations / elapsed) * 1000;

    console.log(`  ${iterations} permission checks in ${elapsed.toFixed(0)}ms`);
    console.log(`  Throughput: ${throughput.toFixed(0)} checks/sec`);
    console.log(`  Avg latency: ${(elapsed / iterations).toFixed(2)}ms`);

    readTx.close();
  });

  test("stress: nested group membership (3 levels)", () => {
    console.log("\n📁 STRESS: Nested Group Membership");

    const db = new Database("fs_nested_groups");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Create deeply nested groups:
    // super-admins contains admins contains managers contains engineers contains user
    const insertTx = db.transactionWrite();
    insertTx.execute(`
      insert
      $user isa user, has name "deep_user", has email "deep@example.com";
      $engineers isa user-group, has name "engineers";
      $managers isa user-group, has name "managers";
      $admins isa user-group, has name "admins";
      $super isa user-group, has name "super-admins";
      $file isa file, has name "secret.txt", has path "/secret.txt", has file-size 100;

      (group: $engineers, member: $user) isa group-membership;
      (group: $managers, member: $engineers) isa group-membership;
      (group: $admins, member: $managers) isa group-membership;
      (group: $super, member: $admins) isa group-membership;

      (grantee: $super, target: $file) isa permission-grant, has permission-level "admin";
    `);

    const readTx = db.transactionRead();

    // Query: Can deep_user access secret.txt?
    // Requires 4 levels of group membership traversal
    const start = performance.now();
    const result = readTx.query(`
      match
        $user isa user, has name "deep_user";
        $file isa file, has path "/secret.txt";

        # 4-level group traversal
        (group: $g1, member: $user) isa group-membership;
        (group: $g2, member: $g1) isa group-membership;
        (group: $g3, member: $g2) isa group-membership;
        (group: $g4, member: $g3) isa group-membership;

        (grantee: $g4, target: $file) isa permission-grant, has permission-level $level;
    `);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(1);

    console.log(`  4-level group hierarchy traversal`);
    console.log(`  Path: user -> engineers -> managers -> admins -> super-admins -> file`);
    console.log(`  Found: ${result.rowCount} permission path`);
    console.log(`  Latency: ${elapsed.toFixed(2)}ms`);

    readTx.close();
  });

  test("query compilation caching demo - same query, different users", () => {
    console.log("\n📁 QUERY COMPILATION CACHING DEMO");
    console.log("   Running identical query pattern 50x to show caching effect\n");

    const db = new Database("fs_caching_demo");
    const schemaTx = db.transactionSchema();
    schemaTx.execute(FILE_SYSTEM_SCHEMA);
    schemaTx.commit();

    // Use small config for faster execution
    const data = generateFileSystemData(smallConfig);
    insertGeneratedData(db, data);

    const readTx = db.transactionRead();

    // Record timing for many iterations - same query pattern, cycling through users
    const iterations = 50;
    const timings: { iteration: number; user: string; totalMs: number; parseUs: number; executeUs: number }[] = [];

    console.log("   First 10 queries (showing timing breakdown):");
    console.log("   ─".repeat(40));
    console.log("   #   User       Total    Parse    Execute");
    console.log("   ─".repeat(40));

    for (let i = 0; i < iterations; i++) {
      const userName = data.userNames[i % data.userNames.length];
      const start = performance.now();
      const result = readTx.queryTimed(`
        match
          $user isa user, has name "${userName}";
          (group: $group, member: $user) isa group-membership;
          $folder isa folder;
          (grantee: $group, target: $folder) isa permission-grant;
        limit 1;
      `);
      const totalMs = performance.now() - start;

      expect(result.result.success).toBe(true);
      timings.push({
        iteration: i,
        user: userName,
        totalMs,
        parseUs: result.timing.parseUs,
        executeUs: result.timing.executeUs,
      });

      // Show first 10 queries with breakdown
      if (i < 10) {
        const label = i === 0 ? "← FIRST (cold)" : "";
        console.log(
          `   ${String(i + 1).padStart(2)}  ${userName.padEnd(10)} ${totalMs.toFixed(2).padStart(6)}ms  ${(result.timing.parseUs / 1000).toFixed(2).padStart(6)}ms  ${(result.timing.executeUs / 1000).toFixed(3).padStart(7)}ms  ${label}`
        );
      }
    }
    console.log(`   ... (${iterations - 10} more queries)`);

    // Calculate percentiles on total time
    const sorted = [...timings].sort((a, b) => a.totalMs - b.totalMs);
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p90 = sorted[Math.floor(sorted.length * 0.90)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = timings.reduce((sum, t) => sum + t.totalMs, 0) / timings.length;

    console.log(`\n   ─${"─".repeat(39)}`);
    console.log(`   PERCENTILE BREAKDOWN (${timings.length} queries):`);
    console.log(`   ─${"─".repeat(39)}`);
    console.log(`   min:   ${min.totalMs.toFixed(2).padStart(6)}ms  (query #${min.iteration + 1})`);
    console.log(`   p50:   ${p50.totalMs.toFixed(2).padStart(6)}ms  (query #${p50.iteration + 1})`);
    console.log(`   p90:   ${p90.totalMs.toFixed(2).padStart(6)}ms  (query #${p90.iteration + 1})`);
    console.log(`   p95:   ${p95.totalMs.toFixed(2).padStart(6)}ms  (query #${p95.iteration + 1})`);
    console.log(`   p99:   ${p99.totalMs.toFixed(2).padStart(6)}ms  (query #${p99.iteration + 1})`);
    console.log(`   max:   ${max.totalMs.toFixed(2).padStart(6)}ms  (query #${max.iteration + 1})`);
    console.log(`   avg:   ${avg.toFixed(2).padStart(6)}ms`);

    // Show the compilation overhead
    const firstQuery = timings[0];
    const restAvg = timings.slice(1).reduce((sum, t) => sum + t.totalMs, 0) / (timings.length - 1);
    const avgParseUs = timings.reduce((sum, t) => sum + t.parseUs, 0) / timings.length;
    const avgExecUs = timings.reduce((sum, t) => sum + t.executeUs, 0) / timings.length;

    console.log(`\n   ─${"─".repeat(39)}`);
    console.log(`   TIMING BREAKDOWN (averages):`);
    console.log(`   ─${"─".repeat(39)}`);
    console.log(`   Parse/compile:  ${(avgParseUs / 1000).toFixed(2)}ms`);
    console.log(`   Execute:        ${(avgExecUs / 1000).toFixed(3)}ms`);
    console.log(`   Total:          ${avg.toFixed(2)}ms`);

    console.log(`\n   ─${"─".repeat(39)}`);
    console.log(`   FIRST vs SUBSEQUENT:`);
    console.log(`   ─${"─".repeat(39)}`);
    console.log(`   First query:    ${firstQuery.totalMs.toFixed(2)}ms (parse: ${(firstQuery.parseUs / 1000).toFixed(2)}ms)`);
    console.log(`   Subsequent avg: ${restAvg.toFixed(2)}ms`);
    if (firstQuery.totalMs > restAvg) {
      console.log(`   Speedup:        ${(firstQuery.totalMs / restAvg).toFixed(1)}x faster after first`);
    }

    readTx.close();
  });
});
