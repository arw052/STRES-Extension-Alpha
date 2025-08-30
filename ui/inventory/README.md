# STRES Inventory UI System

## Overview
The STRES Inventory UI provides a flexible, configurable interface for managing character inventory in SillyTavern. It supports three display modes that users can enable/disable based on their preferences.

## Features

### 1. Quickbar Widget
- **Compact Mode**: Minimal display showing item count and weight indicator
- **Full Mode**: Detailed view with equipped gear, weight bar, and quick actions
- **Position**: Configurable (top, bottom, left, right)
- **Real-time Updates**: Automatically refreshes when inventory changes

### 2. Chat Commands
- `/inventory` or `/inv` - Display full inventory
- `/inventory [filter]` - Filter by category (weapons, armor, consumables)
- `/equip <item>` - Equip an item
- `/unequip <item>` - Unequip an item
- `/use <item>` - Use a consumable
- `/search <query>` - Search for items
- `/iteminfo <item>` - Get detailed item information
- `/invhelp` - Show all available commands

### 3. Full Panel (Optional)
- Grid/List/Equipment views
- Drag & drop support
- Advanced filtering and sorting
- Bulk operations

## Architecture

```
inventory/
├── core/
│   ├── InventoryManager.ts      # Central state management
│   ├── ConfigManager.ts         # User preferences
│   └── CommandProcessor.ts      # Slash command handling
├── components/
│   ├── QuickbarWidget.ts        # Quickbar UI component
│   ├── ChatDisplay.ts           # Chat-based displays
│   └── FullPanel.ts             # Full inventory panel
├── formatters/
│   ├── TextFormatter.ts         # ASCII art formatting
│   └── InteractiveFormatter.ts  # HTML rich formatting
└── integration/
    └── SillyTavernHooks.ts      # SillyTavern integration
```

## Configuration

User preferences are stored in localStorage and can be configured through the settings panel:

```javascript
{
  "quickbar": {
    "enabled": true,
    "position": "bottom",
    "showWeight": true,
    "showItemCount": true,
    "showEquippedGear": false,
    "compactMode": false
  },
  "chatCommands": {
    "enabled": true,
    "richFormatting": true,
    "interactiveButtons": true,
    "autoCollapse": false,
    "pageSize": 10
  },
  "fullPanel": {
    "enabled": false,
    "defaultView": "grid",
    "showAdvanced": false,
    "enableDragDrop": true
  }
}
```

## API Usage

The inventory system exposes a global API at `window.STRES.inventory`:

```javascript
// Execute a command
await STRES.inventory.executeCommand('/inventory');

// Direct actions
await STRES.inventory.equip('sword-of-flames');
await STRES.inventory.use('health-potion');

// Configuration
STRES.inventory.getConfig();
STRES.inventory.setConfig('quickbar.compactMode', true);

// Debugging
STRES.inventory.debug();
```

## Building

The TypeScript files need to be compiled for browser use:

```bash
# Install dependencies
npm install typescript

# Build the inventory UI
./scripts/build-inventory-ui.sh

# Or manually
cd extension
tsc
```

## Integration with SillyTavern

The inventory system automatically integrates with SillyTavern when loaded:

1. **Message Interception**: Hooks into the chat system to detect inventory commands
2. **UI Mounting**: Adds widgets to the quickbar area
3. **Event Listening**: Responds to character changes and chat events
4. **WebSocket Support**: Real-time updates when inventory changes on backend

## Styling

The inventory UI uses SillyTavern's theme variables for consistent appearance:

- `--SmartThemeBlurTintColor`: Background colors
- `--SmartThemeBorderColor`: Borders
- `--SmartThemeBodyColor`: Text color
- `--SmartThemeCheckboxBorderColor`: Accent color

## Mobile Support

The UI is fully responsive with:
- Compact mode auto-enabled on small screens
- Touch-friendly button sizes
- Simplified layouts for mobile
- Reduced animation for performance

## Performance Considerations

- **Caching**: Inventory data cached for 30 seconds
- **Lazy Loading**: Components load on-demand
- **Debouncing**: Updates debounced to prevent spam
- **WebSocket Fallback**: Polling used if WebSocket unavailable

## Testing

To test the inventory UI:

1. Start the backend server (ensure inventory API is running)
2. Load SillyTavern
3. Open browser console and verify: `STRES.inventory` exists
4. Try commands:
   - Type `/inventory` in chat
   - Check quickbar widget appears
   - Test equip/use actions

## Troubleshooting

### Widget Not Appearing
- Check console for errors
- Verify `STRES.inventory.getConfig()` shows quickbar enabled
- Try `STRES.inventory.debug()` for diagnostic info

### Commands Not Working
- Ensure chat commands are enabled in config
- Check if SillyTavern message hook is active
- Verify backend API is responding

### Styling Issues
- Check if SillyTavern theme variables are defined
- Verify inventory.css is loaded
- Try different theme (light/dark) to isolate issue

## Future Enhancements

- [ ] Drag & drop between inventory and chat
- [ ] Item comparison tooltips
- [ ] Inventory search with filters
- [ ] Bulk actions (sell all, drop all)
- [ ] Keyboard shortcuts
- [ ] Export/import inventory
- [ ] Item favoriting/pinning
- [ ] Quick slots for consumables
- [ ] Integration with combat system
- [ ] Trade UI for multiplayer

## Contributing

When adding new features:

1. Follow the existing architecture patterns
2. Update TypeScript interfaces
3. Add configuration options if needed
4. Ensure mobile compatibility
5. Test with different themes
6. Update this documentation

## License

Part of the STRES project - see main project license.