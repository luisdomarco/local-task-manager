---
fileClass: Ticket Analysis
title: "{{title}}"
project: "[[00 {{project}}]]"
kind: diagnosis                        # diagnosis · decision · review · research · retro · ux · brief · report
item: ""                               # "[[KEY-INI-NNN …]]" it belongs to, if any
base: ""                               # "<branch> @ <sha>" the facts were read on
author: ""
supersedes: ""                         # an analysis is immutable; a change of mind is a new one that supersedes it
url: ""
tags: []
creation_date: {{date}}
updated_date: {{date}}
---

# {{title}}

## Question

The one question this analysis answers.

## Base and facts

What was read or measured, on which sha, with which command. Facts only.

## Findings

What the facts show. Each finding with its source.

## Conclusion

The answer to the question, and how confident it is.

## Actions

Only for `retro` and `review`: each action becomes a ticket.

| Action | Type | Priority | Item |
| --- | --- | --- | --- |
| … | initiative / support | P… | [[…]] |

## Not covered

What this analysis does not answer, so nobody reads more into it.

## Related

- 
