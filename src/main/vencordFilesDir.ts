/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";
import { STATIC_DIR } from "shared/paths";

import { State } from "./settings";

// this is in a separate file to avoid circular dependencies
export const BUNDLED_VENCORD_FILES_DIR = join(STATIC_DIR, "vencord");
export const VENCORD_FILES_DIR = State.store.vencordDir || BUNDLED_VENCORD_FILES_DIR;
