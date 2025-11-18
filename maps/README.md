# MAPS Dashboard - Development Files

**Status**: Under Active Development  
**Location**: `tenants/maps/app/static/`

## Overview

This directory contains manually developed dashboard files for the MAPS tenant. These files are **NOT auto-generated** and represent custom development work.

## File Structure

- `index.html` - Main dashboard with board analyses, financial health metrics, revenue by source, and top donors
- `business-data.html` - Business data discovery page (moved from main dashboard)

## Development Workflow

1. **Development**: Edit files in `static/` directory
2. **Testing**: Files are served on port 8082 at `http://localhost:8082/tenants/maps/app`
3. **Merge**: Once stable, merge customizations into the app generator templates

## Server Behavior

The server (`scripts/generators/apps/serve_generated_apps.py`) serves files with this priority:

1. **First**: Check `static/` directory (manual development)
2. **Fallback**: Check `generated/` directory (auto-generated)

This ensures manual development work takes precedence over auto-generated files.

## Merging into App Generator

When ready to merge development work into the app generator:

1. Review customizations in `static/index.html` and `static/business-data.html`
2. Identify reusable patterns and components
3. Update app generator templates in `components/app-generator/templates/`
4. Update business type schemas if needed
5. Test with regeneration: `python3 scripts/generators/apps/regenerate_all_tenant_apps.py`
6. Once verified, files in `static/` can be removed (or kept as reference)

## Key Customizations

### Board Analyses Section
- Financial Health Metrics (Revenue, Expenses, Net Income, Profit Margin)
- Revenue by Source (Donations, Grants, Sales, Other Income)
- Top Donors (Top 20 by total contribution)

### Business Data Page
- Separate page for entity discovery
- Navigation between dashboard and business data

### Time Range Integration
- Board analyses respect UI time range selection
- Date range filtering applied to all queries

## Notes

- Files in `generated/` are overwritten by the app generator
- Files in `static/` are preserved and take precedence
- Always edit files in `static/` during development




