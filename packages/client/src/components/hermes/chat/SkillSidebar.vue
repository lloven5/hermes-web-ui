<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NInput } from 'naive-ui'
import { fetchSkills, type SkillCategory, type SkillInfo } from '@/api/hermes/skills'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const emit = defineEmits<{
  insert: [skillName: string]
}>()

const categories = ref<SkillCategory[]>([])
const archived = ref<SkillInfo[]>([])
const loading = ref(false)
const searchQuery = ref('')
const collapsedCategories = ref<Set<string>>(new Set())
const expandedSkills = ref<Set<string>>(new Set())

const filteredCategories = computed(() => {
  let result = categories.value

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result
      .map(cat => ({
        ...cat,
        skills: cat.skills.filter(
          s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
        ),
      }))
      .filter(cat => cat.skills.length > 0 || cat.name.toLowerCase().includes(q))
  }

  return result
})

const filteredArchived = computed(() => {
  let result = archived.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  }
  return result
})

function toggleCategory(name: string) {
  const next = new Set(collapsedCategories.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  collapsedCategories.value = next
}

function toggleSkillExpand(skillName: string) {
  const next = new Set(expandedSkills.value)
  if (next.has(skillName)) {
    next.delete(skillName)
  } else {
    next.add(skillName)
  }
  expandedSkills.value = next
}

function handleInsert(skillName: string) {
  emit('insert', skillName)
}

async function loadSkills() {
  loading.value = true
  try {
    const data = await fetchSkills()
    categories.value = data.categories
    archived.value = data.archived
  } catch {
    // silently fail — sidebar is auxiliary
  } finally {
    loading.value = false
  }
}

onMounted(loadSkills)
</script>

<template>
  <div class="skill-sidebar">
    <div class="skill-search">
      <NInput
        v-model:value="searchQuery"
        :placeholder="t('chat.searchSkills')"
        size="tiny"
        clearable
      />
    </div>

    <div v-if="loading && categories.length === 0" class="skill-loading">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="filteredCategories.length === 0 && filteredArchived.length === 0" class="skill-empty">
      {{ searchQuery ? t('skills.noMatch') : t('skills.noSkills') }}
    </div>

    <div class="skill-list-content">
      <div v-for="cat in filteredCategories" :key="cat.name" class="skill-category">
        <button class="category-header" @click="toggleCategory(cat.name)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            class="category-chevron" :class="{ collapsed: collapsedCategories.has(cat.name) }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span class="category-name">{{ cat.name }}</span>
          <span class="category-count">{{ cat.skills.length }}</span>
        </button>
        <template v-if="!collapsedCategories.has(cat.name)">
          <div v-for="skill in cat.skills" :key="skill.name" class="skill-item">
            <button class="skill-main" @click="toggleSkillExpand(skill.name)">
              <span class="source-dot" :class="`dot-${skill.source || 'local'}`" />
              <span class="skill-name">{{ skill.name }}</span>
              <svg v-if="skill.description" width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" class="expand-chevron"
                :class="{ expanded: expandedSkills.has(skill.name) }">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button class="skill-insert-btn" :title="t('chat.insertSkill')" @click="handleInsert(skill.name)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div v-if="expandedSkills.has(skill.name) && skill.description" class="skill-description">
              {{ skill.description }}
            </div>
          </div>
        </template>
      </div>

      <div v-if="filteredArchived.length > 0" class="skill-category archive-section">
        <button class="category-header archive-header" @click="toggleCategory('__archived__')">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            class="category-chevron" :class="{ collapsed: collapsedCategories.has('__archived__') }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span class="category-name">{{ t('skills.archived') }}</span>
          <span class="category-count">{{ filteredArchived.length }}</span>
        </button>
        <template v-if="!collapsedCategories.has('__archived__')">
          <div v-for="skill in filteredArchived" :key="skill.name" class="skill-item skill-archived">
            <button class="skill-main" @click="toggleSkillExpand(skill.name)">
              <span class="source-dot" :class="`dot-${skill.source || 'local'}`" />
              <span class="skill-name">{{ skill.name }}</span>
            </button>
            <button class="skill-insert-btn" :title="t('chat.insertSkill')" @click="handleInsert(skill.name)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div v-if="expandedSkills.has(skill.name) && skill.description" class="skill-description">
              {{ skill.description }}
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.skill-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.skill-search {
  padding: 8px 12px;
  flex-shrink: 0;
}

.skill-loading,
.skill-empty {
  padding: 24px 16px;
  font-size: 13px;
  color: $text-muted;
  text-align: center;
}

.skill-list-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
}

.skill-category {
  margin-bottom: 2px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  color: $text-secondary;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  cursor: pointer;
  border-radius: $radius-sm;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.04);
  }
}

.archive-header {
  color: $text-muted;
}

.category-chevron {
  flex-shrink: 0;
  transition: transform $transition-fast;
  transform: rotate(180deg);

  &.collapsed {
    transform: rotate(0deg);
  }
}

.category-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-count {
  font-size: 10px;
  color: $text-muted;
  background: rgba(var(--accent-primary-rgb), 0.06);
  padding: 1px 5px;
  border-radius: 8px;
}

.skill-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 2px 8px 2px 12px;
  gap: 0;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.04);
  }
}

.skill-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: $text-secondary;
  font-size: 12px;
  cursor: pointer;
  padding: 5px 2px;
  text-align: left;

  &:hover {
    color: $text-primary;
  }
}

.source-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-builtin { background: #888; }
.dot-hub { background: #4a90d9; }
.dot-local { background: #66bb6a; }

.skill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-chevron {
  flex-shrink: 0;
  transition: transform $transition-fast;
  opacity: 0.4;

  &.expanded {
    transform: rotate(180deg);
    opacity: 0.6;
  }
}

.skill-insert-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: $text-muted;
  cursor: pointer;
  padding: 4px;
  border-radius: $radius-sm;
  opacity: 0;
  transition: all $transition-fast;
  flex-shrink: 0;

  .skill-item:hover & {
    opacity: 1;
  }

  &:hover {
    color: $accent-primary;
    background: rgba(var(--accent-primary-rgb), 0.08);
  }
}

.skill-description {
  width: 100%;
  padding: 2px 12px 6px 24px;
  font-size: 11px;
  color: $text-muted;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}

.archive-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid $border-color;
}

.skill-archived {
  opacity: 0.6;
}
</style>
