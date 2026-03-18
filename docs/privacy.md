# Analytics Privacy Policy

Impression uses PostHog for product analytics. This document describes what data we collect and what we deliberately avoid collecting.

## Guiding Principle

Analytics should measure _how_ users interact with the app (engagement, timing, completion rates) but never _what_ they choose or write, since card selections reflect personal values.

## Data We Collect

- **Pageview events** with route name, route template, and session ID
- **Aggregate card counts per phase:** agreed/disagreed/unsure counts (swipe), kept/removed counts (prioritize), selected count (manual selection)
- **Interaction quality metrics:** time on card, swipe method (drag vs button), answer length, time spent on questions
- **Phase completion events** (swiping complete, prioritization complete, exploration complete)
- **API call metrics:** endpoint path, latency, error type
- **Import/export counts:** number of sessions imported or exported

## Data We Do NOT Collect

- Which specific cards a user agrees or disagrees with
- Which specific cards a user keeps or removes during prioritization
- Which specific cards a user selects in manual selection
- The text of user answers or freeform notes
- User names, emails, or other personally identifiable information
