'use strict';

function uniqueStrings(values) {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

function validateAndNormalizeGroups(groups, validPartIds) {
  if (!Array.isArray(groups)) {
    return { ok: false, error: 'Groups must be an array' };
  }

  const validPartSet = new Set((validPartIds || []).map((id) => String(id).trim()).filter(Boolean));
  const seenNames = new Set();
  const seenMembers = new Set();
  const normalized = [];

  for (const group of groups) {
    const rawName = String(group?.name || '').trim();
    const nameKey = rawName.toLowerCase();
    if (!rawName) {
      return { ok: false, error: 'Each group must have a non-empty name' };
    }
    if (seenNames.has(nameKey)) {
      return { ok: false, error: `Group name "${rawName}" is duplicated` };
    }

    const partIds = uniqueStrings(Array.isArray(group?.partIds) ? group.partIds : []);
    if (partIds.length < 2) {
      return { ok: false, error: `Group "${rawName}" must contain at least two parts` };
    }

    for (const partId of partIds) {
      if (!validPartSet.has(partId)) {
        return { ok: false, error: `Group "${rawName}" references unknown part "${partId}"` };
      }
      if (seenMembers.has(partId)) {
        return { ok: false, error: `Part "${partId}" cannot belong to multiple groups` };
      }
    }

    partIds.forEach((partId) => seenMembers.add(partId));
    seenNames.add(nameKey);
    normalized.push({ name: rawName, partIds });
  }

  return { ok: true, groups: normalized };
}

function pruneGroupsAgainstPartIds(groups, validPartIds) {
  const validPartSet = new Set((validPartIds || []).map((id) => String(id).trim()).filter(Boolean));
  const pruned = [];

  for (const group of Array.isArray(groups) ? groups : []) {
    const name = String(group?.name || '').trim();
    if (!name) continue;
    const members = uniqueStrings(Array.isArray(group?.partIds) ? group.partIds : []).filter((id) => validPartSet.has(id));
    if (members.length >= 2) {
      pruned.push({ name, partIds: members });
    }
  }

  return pruned;
}

module.exports = {
  pruneGroupsAgainstPartIds,
  validateAndNormalizeGroups,
};
