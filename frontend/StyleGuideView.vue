<script setup lang="ts">
import AppButton from "./AppButton.vue";
</script>

<template>
	<!-- eslint-disable vue/no-restricted-html-elements -->
	<div class="sg-container">
		<!-- Header -->
		<div class="sg-header">
			<h1>Style Guide</h1>
			<p>Design tokens, typography, components, and usage reference</p>
		</div>

		<!-- ===================== 1. COLOR ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Color</h2>
			<p class="sg-section-desc">A restrained palette: one green accent and a neutral gray scale. Semantic colors for feedback only.</p>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Primary &amp; neutrals</div>
				<div class="sg-swatches">
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #1e5639"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Green 700</div>
							<div class="sg-swatch-hex">#1e5639</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #2a6e4e"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Green 600 (primary)</div>
							<div class="sg-swatch-hex">#2a6e4e</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #f3f9f6"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Green 50</div>
							<div class="sg-swatch-hex">#f3f9f6</div>
						</div>
					</div>
				</div>
				<div class="sg-swatches">
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #1a1a1a"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Black</div>
							<div class="sg-swatch-hex">#1a1a1a</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #333"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Gray 800</div>
							<div class="sg-swatch-hex">#333333</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #555"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Gray 600</div>
							<div class="sg-swatch-hex">#555555</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #999"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Gray 400</div>
							<div class="sg-swatch-hex">#737373</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #d5d5d5"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Gray 200</div>
							<div class="sg-swatch-hex">#d5d5d5</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #f5f5f3"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Gray 50</div>
							<div class="sg-swatch-hex">#f5f5f3</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #fff; border-color: #d5d5d5"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">White</div>
							<div class="sg-swatch-hex">#ffffff</div>
						</div>
					</div>
				</div>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Semantic colors</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Used only for feedback states. Never used decoratively.</p>
				<div class="sg-swatches">
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #c0392b"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Error</div>
							<div class="sg-swatch-hex">#c0392b</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #fdf0ee"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Error BG</div>
							<div class="sg-swatch-hex">#fdf0ee</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #b8860b"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Warning</div>
							<div class="sg-swatch-hex">#b8860b</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #fdf8e8"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Warning BG</div>
							<div class="sg-swatch-hex">#fdf8e8</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #2a6e4e"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Success</div>
							<div class="sg-swatch-hex">#2a6e4e</div>
						</div>
					</div>
					<div class="sg-swatch">
						<div class="sg-swatch-color" style="background: #e8f2ec"></div>
						<div class="sg-swatch-info">
							<div class="sg-swatch-name">Success BG</div>
							<div class="sg-swatch-hex">#e8f2ec</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- ===================== 2. TYPOGRAPHY ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Typography</h2>
			<p class="sg-section-desc">EB Garamond for headings and italic subheadings. PT Serif for body, buttons, metadata, and all other text. All headings use sentence case.</p>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Heading styles</div>
				<p style="color: var(--color-gray-600); margin-bottom: var(--space-6)">All headings are EB Garamond in black. Hierarchy comes from size and weight alone — no color variation and no decorative rules. Green is reserved for interactive elements (links, buttons, focus accents) and should not appear in headings.</p>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">H1 &middot; EB Garamond &middot; 36px &middot; weight 500</span>
					</div>
					<div style="font-family: var(--font-heading); font-size: var(--text-4xl); font-weight: 500; line-height: var(--leading-tight); color: var(--color-black)">Page title heading</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">H2 &middot; EB Garamond &middot; 30px &middot; weight 500</span>
					</div>
					<div style="font-family: var(--font-heading); font-size: var(--text-3xl); font-weight: 500; line-height: var(--leading-tight); color: var(--color-black)">Section heading</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">H3 &middot; EB Garamond &middot; 24px &middot; weight 600</span>
					</div>
					<div style="font-family: var(--font-heading); font-size: var(--text-2xl); font-weight: 600; line-height: var(--leading-tight); color: var(--color-black)">Subsection heading</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">H4 &middot; EB Garamond &middot; 20px &middot; weight 600</span>
					</div>
					<div style="font-family: var(--font-heading); font-size: var(--text-xl); font-weight: 600; line-height: var(--leading-tight); color: var(--color-black)">Minor heading</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">Subtitle &middot; EB Garamond &middot; 18px &middot; italic, weight 400 &middot; gray-600</span>
					</div>
					<div style="font-family: var(--font-heading); font-size: var(--text-lg); font-weight: 400; font-style: italic; line-height: var(--leading-normal); color: var(--color-gray-600)">A descriptive subtitle or supporting phrase</div>
				</div>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Body text</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">Body &middot; PT Serif &middot; 16px &middot; weight 400 &middot; gray-800</span>
					</div>
					<div style="font-family: var(--font-body); font-size: var(--text-base); line-height: var(--leading-relaxed); color: var(--color-gray-800); max-width: 600px">Your quarterly report is now available for review. All transactions have been reconciled and verified against the original records. Please review the attached documents and contact our <a href="#">account manager</a> with any questions.</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">Small / meta &middot; PT Serif &middot; 13px &middot; weight 400 &middot; gray-400</span>
					</div>
					<div style="font-family: var(--font-body); font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--color-gray-400)">Last updated February 14, 2026 &middot; Document reference #TQ-20260214</div>
				</div>

				<div class="sg-type-specimen">
					<div class="sg-type-meta">
						<span class="sg-label">Caption / fine print &middot; PT Serif &middot; 12px &middot; weight 400 &middot; gray-400</span>
					</div>
					<div style="font-family: var(--font-body); font-size: var(--text-xs); line-height: var(--leading-normal); color: var(--color-gray-400)">This document is confidential and intended for authorized recipients only.</div>
				</div>
			</div>
		</div>

		<!-- ===================== 3. SPACING ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Spacing scale</h2>
			<p class="sg-section-desc">Based on a 4px unit. Use consistently for padding, margins, and gaps.</p>

			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-1 &nbsp; 4px</span>
				<div class="sg-spacing-block" style="width: 4px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-2 &nbsp; 8px</span>
				<div class="sg-spacing-block" style="width: 8px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-3 &nbsp; 12px</span>
				<div class="sg-spacing-block" style="width: 12px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-4 &nbsp; 16px</span>
				<div class="sg-spacing-block" style="width: 16px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-5 &nbsp; 20px</span>
				<div class="sg-spacing-block" style="width: 20px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-6 &nbsp; 24px</span>
				<div class="sg-spacing-block" style="width: 24px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-8 &nbsp; 32px</span>
				<div class="sg-spacing-block" style="width: 32px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-10 &nbsp;40px</span>
				<div class="sg-spacing-block" style="width: 40px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-12 &nbsp;48px</span>
				<div class="sg-spacing-block" style="width: 48px"></div>
			</div>
			<div class="sg-spacing-row">
				<span class="sg-spacing-label">--space-16 &nbsp;64px</span>
				<div class="sg-spacing-block" style="width: 64px"></div>
			</div>
		</div>

		<!-- ===================== 4. COMPONENTS ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Components</h2>
			<p class="sg-section-desc">Core UI components with their states.</p>

			<!-- Links -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Links</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Links are green and underlined by default. On hover, the green darkens. On focus, links show a double-outline ring matching the secondary button focus style (1px white gap + 2px green ring).</p>

				<h4 class="sg-group-label">Inline links</h4>
				<p style="margin-bottom: var(--space-6)">Used within body text. Always underlined so they're identifiable in running prose: <a href="#">View full report</a> &middot; <a href="#">Account settings</a> &middot; <a href="#">Contact support</a></p>

				<h4 class="sg-group-label">Navigation links</h4>
				<p style="margin-bottom: var(--space-4)">Used in navigation bars, sidebars, and menus. Wrap navigation links in a <code style="font-size: var(--text-sm); background: var(--color-gray-50); padding: 2px 4px">&lt;nav&gt;</code> element — this triggers the no-underline override. Mark the current page with <code style="font-size: var(--text-sm); background: var(--color-gray-50); padding: 2px 4px">aria-current="page"</code> instead of a CSS class. Underline appears on hover. The active page is shown in black and bold with no hover effect.</p>
				<nav class="sg-mockup-nav-links" style="max-width: 500px; border: var(--border-thin); padding: var(--space-3) var(--space-6); font-family: var(--font-body); margin-bottom: var(--space-4)">
					<a href="#">Dashboard</a>
					<a href="#" aria-current="page">Reports</a>
					<a href="#">Settings</a>
				</nav>
			</div>

			<!-- Buttons -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Buttons</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Two axes: variant (primary = solid fill, secondary = outline) and emphasis (default = green, muted = gray). Use muted emphasis for neutral or de-emphasized actions like disagree, unsure, or undo. Hover darkens the fill (primary) or adds a tinted background (secondary). Focus shows a double-outline ring. On press, the button text nudges down 1px via an inner span transform — the border stays anchored while only the text moves.</p>
				<h4 class="sg-group-label">Primary (CTA) — solid green</h4>
				<div class="sg-button-row">
					<AppButton variant="primary">Submit report</AppButton>
					<AppButton variant="primary">Save changes</AppButton>
				</div>
				<h4 class="sg-group-label">Secondary (non-CTA) — green outline</h4>
				<div class="sg-button-row">
					<AppButton variant="secondary">Cancel</AppButton>
					<AppButton variant="secondary">View details</AppButton>
				</div>
				<h4 class="sg-group-label">Primary muted — solid gray</h4>
				<div class="sg-button-row">
					<AppButton variant="primary" emphasis="muted">Disagree</AppButton>
					<AppButton variant="primary" emphasis="muted">Remove</AppButton>
				</div>
				<h4 class="sg-group-label">Secondary muted — gray outline</h4>
				<div class="sg-button-row">
					<AppButton variant="secondary" emphasis="muted">Unsure</AppButton>
					<AppButton variant="secondary" emphasis="muted">Undo</AppButton>
				</div>
				<h4 class="sg-group-label">Disabled</h4>
				<div class="sg-button-row">
					<AppButton variant="primary" :disabled="true">Unavailable</AppButton>
				</div>
			</div>

			<!-- Form Inputs -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Form inputs</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Underline + light gray background fill. On focus, the underline turns green and a 1px green left accent fades in (via inset box-shadow). Placeholders and validation messages are italic — italic signals transient text (placeholders disappear when you type; validation messages disappear when you fix the issue).</p>

				<h4 class="sg-group-label">Default</h4>
				<div class="form-group">
					<label>Full name <span class="required">(required)</span></label>
					<input type="text" value="Jane Doe" />
				</div>

				<div class="form-group">
					<label>Email address</label>
					<input type="email" placeholder="you@example.com" />
					<div class="input-hint">We'll never share your email.</div>
				</div>

				<div class="form-group">
					<label>Notes</label>
					<textarea placeholder="Add any additional context here..."></textarea>
				</div>

				<h4 class="sg-group-label">Error state</h4>
				<div class="form-group">
					<label>Email address</label>
					<input class="input-error" type="email" value="not-an-email" />
					<div class="input-error-msg">Please enter a valid email address.</div>
				</div>

				<div class="form-group">
					<label>Description</label>
					<textarea class="input-error">Too short.</textarea>
					<div class="input-error-msg">Description must be at least 50 characters.</div>
				</div>

				<h4 class="sg-group-label">Success state</h4>
				<div class="form-group">
					<label>Email address</label>
					<input type="email" value="jane@example.com" />
					<div class="input-success-msg">Email address is valid.</div>
				</div>

				<h4 class="sg-group-label">Disabled state</h4>
				<div class="form-group">
					<label>Account ID</label>
					<input type="text" value="Read only value" disabled />
				</div>

				<div class="form-group">
					<label>System notes</label>
					<textarea disabled>This field is not editable.</textarea>
				</div>
			</div>

			<!-- Drop-downs -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Drop-down inputs</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Same underline + gray fill treatment as text inputs. A custom chevron replaces the native browser arrow. On focus, the green underline and left accent appear, matching text inputs exactly.</p>

				<h4 class="sg-group-label">Default</h4>
				<div class="form-group">
					<label>Country</label>
					<select>
						<option value="" disabled selected>Select a country</option>
						<option>Canada</option>
						<option>United Kingdom</option>
						<option>United States</option>
					</select>
				</div>

				<h4 class="sg-group-label">Error state</h4>
				<div class="form-group">
					<label>Country</label>
					<select class="input-error">
						<option value="" disabled selected>Select a country</option>
						<option>Canada</option>
						<option>United Kingdom</option>
						<option>United States</option>
					</select>
					<div class="input-error-msg">Please select a country.</div>
				</div>

				<h4 class="sg-group-label">Disabled state</h4>
				<div class="form-group">
					<label>Region</label>
					<select disabled>
						<option>North America</option>
					</select>
				</div>
			</div>

			<!-- Alerts -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Feedback &amp; alerts</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Use <code style="font-size: var(--text-sm); background: var(--color-gray-50); padding: 2px 4px">alert alert-error</code> for non-field errors (failed loads, network issues). When the error is retryable, include a <code style="font-size: var(--text-sm); background: var(--color-gray-50); padding: 2px 4px">retry-link</code> button inside the alert.</p>
				<div class="alert alert-success">Your changes have been saved successfully.</div>
				<div class="alert alert-warning">Your session will expire in 5 minutes.</div>
				<div class="alert alert-error">Unable to process your request. Please try again.</div>
				<div class="alert alert-error">Could not load summary. <a class="retry-link" role="button" tabindex="0">Retry</a></div>
			</div>

			<!-- Chips -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Chips</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Small inline labels for status or metadata. Sharp corners, semibold text, background fill. Three semantic variants match the alert color scheme, plus a dedicated AI-generated variant. Chip text uses sentence case, like all other UI text.</p>

				<h4 class="sg-group-label">Success</h4>
				<div class="sg-chip-row">
					<span class="chip chip-success">Complete</span>
					<span class="chip chip-success">Explored</span>
				</div>
				<h4 class="sg-group-label">Warning</h4>
				<div class="sg-chip-row">
					<span class="chip chip-warning">In progress</span>
				</div>
				<h4 class="sg-group-label">AI-generated</h4>
				<div class="sg-chip-row">
					<p style="--chip-parent-cap: 1cap">I am AI-generated text. <span class="chip chip-ai">AI-generated</span></p>
				</div>
				<p style="font-size: var(--text-sm); color: var(--color-gray-600); margin-top: var(--space-2)">Use <code>chip-ai</code> to label content that was generated by AI.</p>
				<h4 class="sg-group-label">Neutral</h4>
				<div class="sg-chip-row">
					<span class="chip chip-neutral">Most important</span>
					<span class="chip chip-neutral">Least important</span>
				</div>
				<p style="font-size: var(--text-sm); color: var(--color-gray-600); margin-top: var(--space-2)">Use <code>chip-neutral</code> for informational labels without positive or negative connotation.</p>
			</div>

			<!-- Tables -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Tables</div>
				<table>
					<thead>
						<tr>
							<th>Region</th>
							<th>Q1 Revenue</th>
							<th>Change</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Northeast</td>
							<td>$482,300</td>
							<td>+18%</td>
						</tr>
						<tr>
							<td>Southeast</td>
							<td>$314,100</td>
							<td>+7%</td>
						</tr>
						<tr>
							<td>West</td>
							<td>$271,500</td>
							<td>+9%</td>
						</tr>
						<tr>
							<td>Midwest</td>
							<td>$198,700</td>
							<td>+4%</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- Lists -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Lists</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Lists inherit body text styling. Default browser markers (disc for unordered, decimal for ordered) maintain the print-inspired feel. Spacing follows the 4px grid.</p>

				<h4 class="sg-group-label">Unordered list</h4>
				<ul style="max-width: 600px; margin-bottom: var(--space-6)">
					<li>Total revenue reached $1.27M this quarter</li>
					<li>Northeast region led growth at 18%</li>
					<li>Fourteen new enterprise accounts were opened</li>
				</ul>

				<h4 class="sg-group-label">Ordered list</h4>
				<ol style="max-width: 600px; margin-bottom: var(--space-6)">
					<li>Review the quarterly performance data</li>
					<li>Verify all transactions against original records</li>
					<li>Submit final report to compliance</li>
				</ol>

				<h4 class="sg-group-label">Nested list</h4>
				<ul style="max-width: 600px; margin-bottom: var(--space-6)">
					<li>
						Revenue breakdown
						<ul>
							<li>Northeast: $482,300 (+18%)</li>
							<li>Southeast: $314,100 (+7%)</li>
							<li>West: $271,500 (+9%)</li>
						</ul>
					</li>
					<li>New accounts: 14 opened</li>
					<li>Compliance: audit completed</li>
				</ul>
			</div>

			<!-- Blockquotes -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Blockquotes</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-4)">Blockquotes use a 3px green left border consistent with card-left and alerts. No background fill keeps them print-clean. Text is gray-600 to visually separate from surrounding prose. Use <code style="font-size: var(--text-sm); background: var(--color-gray-50); padding: 2px 4px">&lt;cite&gt;</code> for attributions.</p>

				<h4 class="sg-group-label">With attribution</h4>
				<blockquote style="max-width: 600px; margin-bottom: var(--space-6)">
					<p>The purpose of life is not to be happy. It is to be useful, to be honorable, to be compassionate, to have it make some difference that you have lived and lived well.</p>
					<cite>Ralph Waldo Emerson</cite>
				</blockquote>

				<h4 class="sg-group-label">Without attribution</h4>
				<blockquote style="max-width: 600px; margin-bottom: var(--space-6)">
					<p>All transactions for this period have been reconciled and verified against the original records. Overall revenue grew 12% compared to the prior quarter.</p>
				</blockquote>
			</div>

			<!-- Cards -->
			<div class="sg-subsection">
				<div class="sg-subsection-title">Cards</div>
				<p style="font-size: var(--text-base); color: var(--color-gray-600); margin-bottom: var(--space-6)">Two card variants, chosen based on context. Both are print-friendly with no background fills or shadows.</p>

				<h4 class="sg-group-label">Horizontal rules — for stacked, single-column content</h4>
				<div style="max-width: 600px; margin-bottom: var(--space-8)">
					<div class="card-hrule">
						<div class="card-title">Quarterly revenue summary</div>
						<div class="card-body">Total revenue reached $1.27M this quarter, representing a 12% increase over Q4 2025.</div>
						<div class="card-meta">Source: Finance &middot; Updated February 14, 2026</div>
					</div>
					<div class="card-hrule">
						<div class="card-title">New account onboarding</div>
						<div class="card-body">Fourteen new enterprise accounts were opened, exceeding the target of ten.</div>
						<div class="card-meta">Source: Sales &middot; Updated February 12, 2026</div>
					</div>
					<div class="card-hrule">
						<div class="card-title">Compliance status</div>
						<div class="card-body">Annual audit completed with no material findings. Two minor items noted.</div>
						<div class="card-meta">Source: Legal &middot; Updated February 10, 2026</div>
					</div>
				</div>

				<h4 class="sg-group-label">Green left border — for multi-column grid layouts</h4>
				<div class="cards-grid" style="margin-bottom: var(--space-6)">
					<div class="card-left">
						<div class="card-title">Revenue</div>
						<div class="card-body">$1.27M total, up 12% over Q4. Northeast region led growth at 18%.</div>
						<div class="card-meta">Finance &middot; Feb 14</div>
					</div>
					<div class="card-left">
						<div class="card-title">New accounts</div>
						<div class="card-body">14 enterprise accounts opened, exceeding the quarterly target of 10.</div>
						<div class="card-meta">Sales &middot; Feb 12</div>
					</div>
					<div class="card-left">
						<div class="card-title">Compliance</div>
						<div class="card-body">Annual audit completed with no material findings. Two minor items noted.</div>
						<div class="card-meta">Legal &middot; Feb 10</div>
					</div>
					<div class="card-left">
						<div class="card-title">Client satisfaction</div>
						<div class="card-body">NPS score rose to 72, up from 65 last quarter. Response rate was 44%.</div>
						<div class="card-meta">Support &middot; Feb 13</div>
					</div>
				</div>

				<p style="font-size: var(--text-base); color: var(--color-gray-600)"><em>Usage note:</em> Either variant may be used in any layout context at the designer's discretion. As a starting point, horizontal rules work well for sequential, list-like content, while the green left border works well for independent, side-by-side items.</p>
			</div>
		</div>

		<!-- ===================== 5. PRINCIPLES ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Design principles</h2>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Print-inspired, screen-aware</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">The design draws from print conventions: sharp corners, thin rules, typographic hierarchy, and generous whitespace. However, it respects screen conventions where usability demands it (focus states, hover feedback, touch targets).</p>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Subtle color</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Green is used sparingly — for links, primary buttons, focus accents, and interactive states. It should never appear in headings, body text, or decorative rules. Most of the visual hierarchy comes from typography and spacing, not color.</p>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Flat &amp; sharp</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">No decorative box shadows. No rounded corners. Depth is conveyed through layering of surfaces and thin borders. The exceptions are box-shadows used functionally: inset box-shadows on form inputs to render a left focus accent without layout shift, and outer box-shadows on buttons and links for focus rings. This keeps the interface feeling clean, authoritative, and page-like.</p>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Italic means transient</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Italic text signals content that is temporary or will go away. Placeholders are italic because they disappear when the user begins typing. Validation messages are italic because they disappear when the issue is resolved. This gives italic a consistent semantic role across the system, distinct from its use in EB Garamond subheadings (where it signals a secondary descriptive voice, not transience).</p>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Diagonal lines mean disabled</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Disabled elements use a diagonal stripe pattern rather than a flat gray fill. This provides a universally recognizable visual signal that the element is inactive, and avoids confusion with low-contrast enabled states.</p>
			</div>
		</div>

		<!-- ===================== 6. COPYWRITING ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Copywriting guidelines</h2>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Sentence case</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">All UI text uses sentence case. Only the first word and proper nouns are capitalized. This applies to headings, form labels, button text, navigation items, card titles, tab labels, and menu items.</p>
				<div style="max-width: 500px; font-family: var(--font-body); font-size: var(--text-base); color: var(--color-gray-800); line-height: 2">
					Correct: Quarterly performance report<br />
					Incorrect: <span style="text-decoration: line-through">Quarterly Performance Report</span><br /><br />
					Correct: Email address<br />
					Incorrect: <span style="text-decoration: line-through">Email Address</span><br /><br />
					Correct: Save changes<br />
					Incorrect: <span style="text-decoration: line-through">Save Changes</span><br /><br />
					Correct: Connect to Google Drive (proper noun mid-sentence)<br />
					Incorrect: <span style="text-decoration: line-through">Connect To Google Drive</span><br /><br />
					Correct: Revenue by region<br />
					Correct: Account ID (proper abbreviation)
				</div>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Required fields</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Mark required fields with the word "(required)" in muted text after the label. Do not use an asterisk or other symbols — the meaning should be immediately clear without a legend or footnote.</p>
				<div style="max-width: 400px; margin-bottom: var(--space-4)">
					<label>Full name <span class="required">(required)</span></label>
					<input type="text" placeholder="Jane Doe" />
				</div>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Text alignment</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">All text is left-aligned by default. This includes headings, body text, labels, card content, and table cells. Left alignment creates a strong vertical anchor that the eye follows down the page, which is easier to read and scan than centered text.</p>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Centered text may be used sparingly for standalone elements that are visually separate from the page flow, such as an empty state message in the middle of a blank area, or a single-line status label inside a visual widget. It should never be used for headings, paragraphs, labels, or any text that participates in a reading flow.</p>
			</div>

			<div class="sg-subsection">
				<div class="sg-subsection-title">Terminology</div>
				<p style="color: var(--color-gray-800); max-width: 600px; margin-bottom: var(--space-4)">Avoid the word "card" in user-facing text. Use the source of meaning's name directly, or say "source of meaning" if a generic term is needed.</p>
			</div>
		</div>

		<!-- ===================== 7. COMPOSITION EXAMPLE ===================== -->
		<div class="sg-section">
			<h2 class="sg-section-title">Sample composition</h2>
			<p class="sg-section-desc">A realistic mock page using all design tokens together.</p>

			<div class="sg-mockup">
				<div class="sg-mockup-nav">
					<div class="sg-mockup-logo" style="font-family: var(--font-heading)">Acme Solutions</div>
					<nav class="sg-mockup-nav-links" style="font-family: var(--font-body)">
						<a href="#">Dashboard</a>
						<a href="#" aria-current="page">Reports</a>
						<a href="#">Settings</a>
					</nav>
				</div>
				<div class="sg-mockup-body">
					<h2>Quarterly performance report</h2>
					<div class="subtitle">January – March 2026</div>
					<p style="font-family: var(--font-body)">All transactions for this period have been reconciled and verified against the original records. Overall revenue grew 12% compared to the prior quarter, driven primarily by expansion in the northeast region. Please review the figures below and reach out to your <a href="#">account manager</a> with any questions.</p>

					<h4 style="margin-top: var(--space-8); margin-bottom: var(--space-4)">Key metrics</h4>

					<div class="cards-grid" style="margin-bottom: var(--space-8)">
						<div class="card-left">
							<div class="card-title">Revenue</div>
							<div class="card-body">$1.27M total, up 12% over Q4.</div>
							<div class="card-meta">Finance dept.</div>
						</div>
						<div class="card-left">
							<div class="card-title">New accounts</div>
							<div class="card-body">14 opened, exceeding target of 10.</div>
							<div class="card-meta">Sales dept.</div>
						</div>
					</div>

					<h4 style="margin-bottom: var(--space-4)">Regional breakdown</h4>

					<table style="max-width: 520px; margin-bottom: var(--space-8)">
						<thead>
							<tr>
								<th>Region</th>
								<th>Q1 Revenue</th>
								<th>Change</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Northeast</td>
								<td>$482,300</td>
								<td>+18%</td>
							</tr>
							<tr>
								<td>Southeast</td>
								<td>$314,100</td>
								<td>+7%</td>
							</tr>
							<tr>
								<td>West</td>
								<td>$271,500</td>
								<td>+9%</td>
							</tr>
						</tbody>
					</table>

					<h4 style="margin-bottom: var(--space-4)">Detailed notes</h4>

					<div style="max-width: 600px">
						<div class="card-hrule">
							<div class="card-title">Northeast expansion</div>
							<div class="card-body">The northeast region drove the majority of growth, adding 8 new clients and increasing revenue by 18%. The team has requested additional headcount for Q2.</div>
							<div class="card-meta">Regional lead: J. Torres &middot; Updated Feb 14</div>
						</div>
						<div class="card-hrule">
							<div class="card-title">Product launch feedback</div>
							<div class="card-body">Early feedback on v2.4 has been positive. Three feature requests logged for the Q2 roadmap. <a href="#">View feedback summary</a></div>
							<div class="card-meta">Product team &middot; Updated Feb 13</div>
						</div>
					</div>

					<div style="margin-top: var(--space-8); display: flex; gap: var(--space-3)">
						<AppButton variant="primary">Download full report</AppButton>
						<AppButton variant="secondary">Share</AppButton>
					</div>
					<small style="margin-top: var(--space-4)">Last updated February 14, 2026 &middot; Document ref #QR-2026Q1</small>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.sg-container {
	max-width: 880px;
	margin: 0 auto;
	padding: var(--space-10) var(--space-6) var(--space-16);
}

.sg-header {
	text-align: left;
	padding-bottom: var(--space-10);
	margin-bottom: var(--space-12);
	border-bottom: 1px solid var(--color-gray-200);
}

.sg-header h1 {
	margin-bottom: var(--space-2);
}

.sg-header p {
	font-size: var(--text-base);
	color: var(--color-gray-600);
}

.sg-section {
	margin-bottom: var(--space-16);
}

.sg-section-title {
	margin-bottom: var(--space-2);
}

.sg-section-desc {
	color: var(--color-gray-600);
	font-size: var(--text-base);
	margin-bottom: var(--space-8);
}

.sg-subsection {
	margin-bottom: var(--space-10);
}

.sg-subsection-title {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 600;
	color: var(--color-black);
	margin-bottom: var(--space-4);
}

.sg-label {
	font-family: var(--font-body);
	font-size: var(--text-xs);
	color: var(--color-gray-400);
	letter-spacing: 0.04em;
	margin-bottom: var(--space-1);
}

.sg-token-name {
	font-family: "SF Mono", "Consolas", "Courier New", monospace;
	font-size: 12px;
	color: var(--color-gray-600);
	background: var(--color-gray-50);
	padding: 2px 6px;
	border: 1px solid var(--color-gray-200);
}

.sg-group-label {
	margin-bottom: var(--space-3);
}

.sg-swatches {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-3);
	margin-bottom: var(--space-6);
}

.sg-swatch {
	width: 120px;
}

.sg-swatch-color {
	width: 100%;
	height: 56px;
	border: 1px solid var(--color-gray-200);
}

.sg-swatch-info {
	padding-top: var(--space-2);
}

.sg-swatch-name {
	font-size: var(--text-xs);
	font-weight: 500;
	color: var(--color-black);
}

.sg-swatch-hex {
	font-family: "SF Mono", "Consolas", monospace;
	font-size: 11px;
	color: var(--color-gray-400);
}

.sg-type-specimen {
	margin-bottom: var(--space-8);
	padding-bottom: var(--space-8);
	border-bottom: var(--border-thin);
}

.sg-type-specimen:last-child {
	border-bottom: none;
}

.sg-type-meta {
	display: flex;
	gap: var(--space-4);
	align-items: baseline;
	margin-bottom: var(--space-2);
}

.sg-spacing-row {
	display: flex;
	align-items: center;
	gap: var(--space-4);
	margin-bottom: var(--space-3);
}

.sg-spacing-block {
	background: var(--color-gray-50);
	border: 1px solid var(--color-gray-200);
	height: 24px;
}

.sg-spacing-label {
	font-family: "SF Mono", "Consolas", monospace;
	font-size: 12px;
	color: var(--color-gray-600);
	min-width: 160px;
}

.sg-button-row {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-4);
	align-items: center;
	margin-bottom: var(--space-6);
}

.sg-chip-row {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-3);
	align-items: center;
	margin-bottom: var(--space-6);
}

.sg-mockup {
	background: var(--color-white);
	border: var(--border-thin);
	margin-top: var(--space-6);
}

.sg-mockup-nav {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: var(--space-3) var(--space-6);
	border-bottom: var(--border-thin);
}

.sg-mockup-logo {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-weight: 600;
	color: var(--color-black);
}

.sg-mockup-nav-links {
	display: flex;
	gap: var(--space-6);
	font-size: var(--text-sm);
}

.sg-mockup-body {
	padding: var(--space-8) var(--space-6);
}

.sg-mockup-body h2 {
	margin-bottom: var(--space-1);
}

.sg-mockup-body .subtitle {
	font-family: var(--font-heading);
	font-size: var(--text-lg);
	font-style: italic;
	font-weight: 400;
	color: var(--color-gray-600);
	margin-bottom: var(--space-6);
}

.sg-mockup-body p {
	max-width: 600px;
	margin-bottom: var(--space-4);
	color: var(--color-gray-800);
}

.sg-css-block {
	background: var(--color-gray-50);
	border: var(--border-thin);
	padding: var(--space-4) var(--space-5);
	font-family: "SF Mono", "Consolas", "Courier New", monospace;
	font-size: 12px;
	line-height: 1.7;
	color: var(--color-gray-800);
	overflow-x: auto;
	white-space: pre;
	margin-top: var(--space-4);
	margin-bottom: var(--space-6);
}
</style>
