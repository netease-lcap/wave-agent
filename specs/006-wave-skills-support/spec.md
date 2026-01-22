# Feature Specification: Wave Skills Support

**Feature Branch**: `006-wave-skills-support`  
**Created**: 2024-12-19  
**Status**: Implemented  
**Input**: User description: "support Skill. What are Agent Skills? Agent Skills package expertise into discoverable capabilities. Each Skill consists of a SKILL.md file with instructions that Claude reads when relevant, plus optional supporting files like scripts and templates. How Skills are invoked: Skills are model-invoked—Claude autonomously decides when to use them based on your request and the Skill's description. This is different from slash commands, which are user-invoked (you explicitly type /command to trigger them). Create a Skill Skills are stored as directories containing a SKILL.md file. Personal Skills Personal Skills are available across all your projects. Store them in ~/.claude/skills/: Use personal Skills for: Your individual workflows and preferences Experimental Skills you're developing Personal productivity tools Project Skills Project Skills are shared with your team. Store them in .claude/skills/ within your project: Use project Skills for: Team workflows and conventions Project-specific expertise Shared utilities and scripts Project Skills are checked into git and automatically available to team members. remember replace .claude with .wave . Write SKILL.md Create a SKILL.md file with YAML frontmatter and Markdown content: Field requirements: name: Must use lowercase letters, numbers, and hyphens only (max 64 characters) description: Brief description of what the Skill does and when to use it (max 1024 characters) The description field is critical for Claude to discover when to use your Skill. It should include both what the Skill does and when Claude should use it. Claude to Wave. Add supporting files Create additional files alongside SKILL.md: Reference these files from SKILL.md: Claude reads these files only when needed, using progressive disclosure to manage context efficiently."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Personal Wave Skills (Priority: P1)

A developer wants to create reusable skills for their personal workflow that work across all their Wave projects. They need to package their expertise into discoverable capabilities that Wave can autonomously invoke when relevant.

**Why this priority**: This is the core value proposition - enabling users to extend Wave's capabilities with their own expertise.

**Independent Test**: Can be fully tested by creating a personal skill directory structure with SKILL.md file and verifying Wave can discover and use it across multiple projects.

**Acceptance Scenarios**:

1. **Given** I want to create a personal skill, **When** I create a directory at `~/.wave/skills/my-skill-name/` with a valid SKILL.md file, **Then** Wave should recognize and make this skill available across all my projects
2. **Given** I have created a personal skill with proper YAML frontmatter, **When** I interact with Wave in any project, **Then** Wave should autonomously decide when to invoke this skill based on my requests
3. **Given** I have a personal skill with supporting files, **When** Wave invokes the skill, **Then** it should have access to all referenced files (scripts, templates, documentation)

---

### User Story 2 - Create Project-Specific Wave Skills (Priority: P2)

A development team wants to create shared skills that encapsulate project-specific knowledge, team conventions, and workflows. These skills should be version-controlled and automatically available to all team members.

**Why this priority**: Enables team collaboration and knowledge sharing through skills, building on the foundation of personal skills.

**Independent Test**: Can be tested by creating project skills in `.wave/skills/` directory, committing to git, and verifying team members automatically have access.

**Acceptance Scenarios**:

1. **Given** I want to create a project skill, **When** I create a directory at `.wave/skills/my-skill-name/` with a valid SKILL.md file, **Then** the skill should be available to all team members working on this project
2. **Given** I commit project skills to git, **When** team members clone or pull the repository, **Then** they should automatically have access to these skills without additional setup
3. **Given** a project skill exists, **When** any team member interacts with Wave in this project, **Then** Wave should consider project-specific skills alongside personal skills

---

### User Story 3 - Skill Discovery and Invocation (Priority: P1)

Wave needs to autonomously discover when to use available skills based on user requests and skill descriptions, without requiring explicit user commands.

**Why this priority**: This is the core mechanism that makes skills useful - automatic, intelligent invocation based on context.

**Independent Test**: Can be tested by creating skills with specific descriptions and verifying Wave invokes them appropriately for matching requests.

**Acceptance Scenarios**:

1. **Given** I have skills with descriptive YAML frontmatter, **When** I make a request that matches a skill's purpose, **Then** Wave should autonomously decide to invoke that skill
2. **Given** multiple skills could apply to a request, **When** Wave evaluates available skills, **Then** it should choose the most relevant skill based on the description and context
3. **Given** a skill has supporting files, **When** Wave invokes the skill, **Then** it should progressively load only the files needed for the specific request

---

### User Story 4 - Skill Management and Validation (Priority: P3)

Users need to validate their skill definitions, understand skill structure requirements, and manage their skill collections effectively.

**Why this priority**: While important for usability, this builds on the core functionality and can be implemented after basic skill support works.

**Independent Test**: Can be tested by creating invalid skills and verifying appropriate error messages, plus managing skill collections.

**Acceptance Scenarios**:

1. **Given** I create a SKILL.md file with invalid YAML frontmatter, **When** Wave attempts to load the skill, **Then** it should provide clear error messages about what needs to be fixed
2. **Given** I have multiple skills available, **When** I request information about my skills, **Then** Wave should be able to list and describe available personal and project skills
3. **Given** I modify a skill's SKILL.md file, **When** I interact with Wave, **Then** it should automatically reload the updated skill definition

---

### Edge Cases

- What happens when a skill's SKILL.md file has malformed YAML frontmatter?
- How does Wave handle conflicts between personal and project skills with the same name?
- What happens when referenced supporting files (scripts, templates) are missing or inaccessible?
- How does Wave handle skills with circular references in their supporting files?
- What happens when a skill's name exceeds the 64-character limit or contains invalid characters?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Wave MUST support personal skills stored in `~/.wave/skills/` directory structure
- **FR-002**: Wave MUST support project skills stored in `.wave/skills/` directory structure within projects
- **FR-003**: Wave MUST parse SKILL.md files with YAML frontmatter containing name and description fields
- **FR-004**: Wave MUST validate skill names use only lowercase letters, numbers, and hyphens (max 64 characters)
- **FR-005**: Wave MUST validate skill descriptions are within 1024 character limit
- **FR-006**: Wave MUST autonomously decide when to invoke skills based on user requests and skill descriptions
- **FR-007**: Wave MUST support progressive loading of supporting files (reference.md, examples.md, scripts, templates)
- **FR-008**: Wave MUST prioritize project skills over personal skills when both exist with the same name
- **FR-009**: Wave MUST provide clear error messages for malformed or invalid skill definitions
- **FR-010**: Wave MUST reload skill definitions when SKILL.md files are modified
- **FR-011**: Wave MUST handle missing or inaccessible supporting files gracefully
- **FR-012**: Wave MUST support skills with multiple supporting file types (markdown, scripts, templates)

### Key Entities

- **Skill**: A discoverable capability package consisting of a SKILL.md file with YAML frontmatter (name, description) and optional supporting files
- **Personal Skill**: Skills stored globally in user's home directory (`~/.wave/skills/`) available across all projects
- **Project Skill**: Skills stored in project directory (`.wave/skills/`) shared with team members and version-controlled
- **Skill Directory**: Container holding SKILL.md and optional supporting files (reference.md, examples.md, scripts/, templates/)
- **Supporting File**: Additional resources referenced by skills for progressive disclosure (documentation, examples, utilities, templates)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a functional personal skill that Wave recognizes and invokes within 5 minutes of setup
- **SC-002**: Project teams can share skills through version control with zero additional configuration for team members
- **SC-003**: Wave correctly identifies and invokes the most relevant skill for user requests 90% of the time based on skill descriptions
- **SC-004**: Skills with supporting files load additional resources only when needed, reducing initial response time by maintaining under 500ms skill evaluation time
- **SC-005**: Invalid skill definitions provide actionable error messages that allow users to fix issues in under 2 minutes
- **SC-006**: Skill modifications are automatically detected and reloaded without requiring Wave restart or manual refresh