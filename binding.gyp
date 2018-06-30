{
  "targets": [
    {
      "target_name": "addon",
      "sources": [ "src/extension.cc" ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")",
      ],
      "variables": {
        "use_pkg_config": "<!(pkg-config --exists libtcmalloc || echo no)"
      },
      "conditions": [
        [ "use_pkg_config=='no'", {
          "libraries": [
            "-ltcmalloc",
            "-lprofiler"
          ]
        }, {
          "include_dirs": [
            "<!@(pkg-config libprofiler libtcmalloc --cflags-only-I | sed s/-I//g)"
          ],
          "libraries": [
            "<!@(pkg-config libprofiler libtcmalloc --libs-only-l)"
          ],
          "library_dirs": [
            "<!@(pkg-config libprofiler libtcmalloc --libs-only-L | sed s/-L//g)"
          ]
        }]
      ]
    }
  ]
}
