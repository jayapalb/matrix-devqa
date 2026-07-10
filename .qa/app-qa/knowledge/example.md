---
id: example-playbook-card
title: Example knowledge card — the format the KB expects (replace or delete me)
kind: recipe
tags: [example, template, getting-started]
when: you are writing your FIRST app-specific knowledge card and want the frontmatter + section shape
status: candidate
since: template
author: touchstone init (template card)
---
**What** A knowledge card is a small Markdown "playbook" — a recipe, technique, gotcha, or finding specific
to THIS app. `/qa-learn` writes cards here; `touchstone knowledge` recalls the relevant ones during runs.

**How** Keep the frontmatter valid: `kind` ∈ recipe|technique|gotcha|finding · `status` ∈
candidate|proven|deprecated · `author` and `when` are required (`when` is the recall trigger). Write a
tight **What / How / Why** body. Link related cards with [[their-id]].

**Why** A card that can't be recalled (no `when`) or can't be trusted (no `author`) is dead weight. This
template exists so the folder isn't empty — replace it with a real card, or delete it.
