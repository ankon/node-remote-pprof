{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "src/extension.cc" ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")",
        "<!(pkg-config libprofiler libtcmalloc --cflags-only-I | sed s/-I//g)"
      ],
      "libraries": [
        "<!(pkg-config libprofiler libtcmalloc --libs)"
      ]
    }
  ]
}