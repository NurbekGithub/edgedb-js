CREATE MIGRATION m1coa42c3g4ttifpds3wxwcgb6ko24cpa4yreldi675u5vluph4l7q
    ONTO m1ooskmhgmkiqc66xfkdhtynppvluh6nvn7zsiun4tntkmegxpigrq
{
  CREATE TYPE default::X {
      CREATE PROPERTY a -> std::str;
      CREATE PROPERTY b -> std::int32;
  };
  CREATE TYPE default::Y {
      CREATE PROPERTY a -> std::str;
      CREATE PROPERTY c -> std::bool;
  };
  CREATE TYPE default::Z {
      CREATE LINK xy -> (default::X | default::Y);
  };
};
