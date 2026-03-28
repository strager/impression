# Analytics privacy policy

Impression uses PostHog for product analytics. This document describes what data we collect and what we deliberately avoid collecting.

## Guiding principle

Analytics should measure _how_ users interact with the app (engagement, timing, completion rates) but never _what_ they choose or write, since selections reflect personal values.

## Data we collect

- **Pageview events** with route name, route template, and profile ID
- **Aggregate counts per phase:** agreed/disagreed/unsure counts (swipe), kept/removed counts (prioritize), selected count (manual selection)
- **Interaction quality metrics:** time on source of meaning, swipe method (drag vs button), answer length, time spent on questions
- **Phase completion events** (swiping complete, prioritization complete, examination complete)
- **API call metrics:** endpoint path, latency, error type
- **Import/export counts:** number of profiles imported or exported

## Data we do NOT collect

- Which specific sources of meaning a user agrees or disagrees with
- Which specific sources of meaning a user keeps or removes during prioritization
- Which specific sources of meaning a user selects in manual selection
- The text of user answers or freeform notes
- User names, emails, or other personally identifiable information
