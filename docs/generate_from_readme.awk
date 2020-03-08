#! /usr/bin/env -S gawk -f
#
# This file is intended to be run from generate_doc_folders.sh
#
# This reads in a README, searching for a "Protocol Messages" markdown heading
# and generate a folder and README for each item of the list following it.
#
# VARS:
# - clobber: When set to a truthy, README files will be overwritten

# Get filename and directory of readme in process
BEGIN {
    FILE = ARGV[1]
    "dirname " FILE | getline DIR
}

# Match our start pattern
/#+ *Protocol Messages$/ {
    p=1 # Set print flag to true
    next # Move on to the next line
}

# Match our end pattern and set print flag to false
/^$/ {p=0}

# For every line for which the print flag is set
p {
    match($2, /\[([a-z0-9._-]+)\]\((#[a-z0-9._-]+)\)/, matches)
    name = matches[1]
    link = matches[2]
    if (!name || !link) {
        print "Error: Line does not match expected pattern; skipping:\n    " $0
        next
    }
    target_dir = DIR "/" name
    target = target_dir "/README.md"
    if (!system("test -f " target) && !clobber) {
        print target " already exists; skipping..."
        next
    }
    print "Generating " target_dir "..."
    system("mkdir -p " target_dir)
    printf("See [%s](/docs/%s%s).", name, FILE, link) > target
}
