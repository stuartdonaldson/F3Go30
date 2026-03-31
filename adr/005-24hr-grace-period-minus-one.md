# ADR-005: 24-Hour Grace Period for −1 Marking

Status: Accepted
Date: 2026-03-02

## Context
PAX must record a 1 or 0 in the Tracker sheet each day to log their Go30 progress. If a PAX forgets to fill in their row, the tracker is incomplete. An automated nightly job was added to fill empty cells with −1 to indicate a missed day. The question was when to apply the −1: immediately after midnight (same day), or after allowing a grace period.

## Decision
The daily trigger fires at 1 AM and marks empty cells as −1 for the column representing **two days prior** (i.e., a 24-hour grace period from the prior day's close). PAX have until approximately 1 AM the following day to record their entry before it is permanently marked.

## Consequences
- PAX who fill out the Tracker sheet late (e.g., the next morning) will have their entry honored as long as they do so before 1 AM.
- The grace period is implicit in the code (`thresholdday.setDate(thresholdday.getDate() - 2)`) and is not configurable without a code change.
- If the nightly trigger fails to run, the grace window effectively extends — there is no compensating mechanism.
